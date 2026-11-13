/**
 * The client side of offline sync. Bills in the queue are POSTed in batches, in
 * the order their numbers were issued. `client_uuid` makes every retry safe.
 *
 *  - saved (or already saved earlier)      → synced
 *  - network down, 429, 5xx, server_error  → stays pending, tried again with backoff
 *  - the server refuses the bill           → conflict: kept and shown, never dropped
 *  - signed out                            → paused until the user signs in again
 *
 * Framework-free: it talks to an OfflineRepo and a `send` function, so the
 * whole engine is unit tested against an in-memory repo.
 */
import { compareNumbers } from "./numbering";
import { CODE_DEFERRED, SYNC_BATCH_MAX, SYNC_ENDPOINT, type SyncItemResult, type SyncRequestBody, type SyncResponseBody } from "./protocol";
import { META_LAST_SYNC, type OfflineRepo, type QueueRow } from "./types";
import type { SaleInput } from "@/lib/validation/sales";

export const BACKOFF_BASE_MS = 5_000;
export const BACKOFF_MAX_MS = 15 * 60_000;
/** After this many temporary server errors for the same bill, stop trying on our own and ask the user. */
export const MAX_ROW_ATTEMPTS = 8;
export const SYNCED_HISTORY_MS = 7 * 24 * 60 * 60_000;
export const SYNC_INTERVAL_MS = 60_000;
const MAX_BATCHES_PER_RUN = 40;
const SEND_TIMEOUT_MS = 45_000;
export const META_SYNC_PAUSE = "sync.pause";

/** Temporary trouble: try the same bill again later. */
export const RETRYABLE_CODES: ReadonlySet<string> = new Set(["server_error", CODE_DEFERRED, "rate_limited", "network"]);

/** The server looked at the bill and said no. A person has to decide what happens next. */
export const CONFLICT_CODES: ReadonlySet<string> = new Set([
  "totals_mismatch",
  "number_conflict",
  "number_invalid",
  "device_invalid",
  "forbidden",
  "invalid",
  "insufficient_stock",
  "discount_over_limit",
  "price_override_denied",
  "series_missing",
]);

export type ResultClass = "synced" | "retry" | "conflict";

/** What to do with one bill's result. Anything we do not recognise is shown to the user, never retried forever or dropped. */
export function classifyResult(result: Pick<SyncItemResult, "ok" | "code"> | undefined): ResultClass {
  if (!result) return "retry";
  if (result.ok) return "synced";
  return RETRYABLE_CODES.has(result.code ?? "") ? "retry" : "conflict";
}

export type HttpClass = "ok" | "auth" | "business_mismatch" | "retry";

/** What a response status means for the whole batch. */
export function classifyHttp(status: number): HttpClass {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401) return "auth";
  if (status === 409) return "business_mismatch";
  return "retry";
}

/** 5s, 10s, 20s … capped at 15 minutes. `attempts` is the number of tries so far (1 after the first failure). */
export function backoffMs(attempts: number): number {
  if (!Number.isFinite(attempts) || attempts <= 0) return 0;
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(attempts - 1, 20));
}

const seriesKey = (row: Pick<QueueRow, "number" | "outletId">) => `${row.outletId}:${row.number.slice(0, row.number.lastIndexOf("/"))}`;

/**
 * The next bills to send: oldest number first, at most `max`. A bill that is
 * waiting for its retry time holds back the later bills of the same series, so
 * the server never sees number 12 before number 11 and reports a false gap.
 */
export function selectBatch(rows: QueueRow[], now: number, opts: { force?: boolean; max?: number; skip?: ReadonlySet<string> } = {}): QueueRow[] {
  const max = opts.max ?? SYNC_BATCH_MAX;
  const candidates = rows
    .filter((r) => r.status === "pending" || (opts.force && r.status === "failed"))
    .sort((a, b) => compareNumbers(a.number, b.number) || a.createdAt - b.createdAt);
  const blocked = new Set<string>();
  const batch: QueueRow[] = [];
  for (const row of candidates) {
    const key = seriesKey(row);
    if (blocked.has(key)) continue;
    const due = opts.skip?.has(row.clientUuid) ? false : opts.force || row.nextAttemptAt <= now;
    if (!due) {
      blocked.add(key);
      continue;
    }
    batch.push(row);
    if (batch.length >= max) break;
  }
  return batch;
}

export type SendOutcome =
  | { kind: "ok"; results: SyncItemResult[] }
  | { kind: "auth" }
  | { kind: "business_mismatch" }
  | { kind: "retry"; reason: string };

export type SyncState = "done" | "auth" | "business_mismatch" | "unreachable" | "backoff";

export interface SyncSummary {
  state: SyncState;
  synced: number;
  conflicts: number;
  retried: number;
  /** Why the server could not be reached, when it could not. */
  reason?: string;
}

export interface SyncDeps {
  repo: OfflineRepo;
  send(invoices: SaleInput[]): Promise<SendOutcome>;
  now(): number;
}

interface PauseState {
  failures: number;
  until: number;
}

/** One sync run. Call it under `withSyncLock` so only one tab runs at a time. */
export async function runSync(deps: SyncDeps, opts: { force?: boolean } = {}): Promise<SyncSummary> {
  const { repo } = deps;
  const summary: SyncSummary = { state: "done", synced: 0, conflicts: 0, retried: 0 };

  // A run that died half way (tab closed) leaves bills marked "syncing". We hold the lock, so nobody is sending them.
  const stale = (await repo.listQueue()).filter((r) => r.status === "syncing");
  if (stale.length > 0) await repo.patchQueueRows(stale.map((r) => ({ clientUuid: r.clientUuid, patch: { status: "pending" as const } })));

  if (!opts.force) {
    const pause = await repo.getMeta<PauseState>(META_SYNC_PAUSE);
    if (pause && deps.now() < pause.until) return { ...summary, state: "backoff" };
  }

  const tried = new Set<string>();
  for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
    const now = deps.now();
    const batch = selectBatch(await repo.listQueue(), now, { force: opts.force, skip: tried });
    if (batch.length === 0) break;
    for (const row of batch) tried.add(row.clientUuid);
    await repo.patchQueueRows(batch.map((r) => ({ clientUuid: r.clientUuid, patch: { status: "syncing" as const } })));

    let outcome: SendOutcome;
    try {
      outcome = await deps.send(batch.map((r) => r.input));
    } catch (error) {
      outcome = { kind: "retry", reason: error instanceof Error ? error.message : "Could not reach the server" };
    }

    if (outcome.kind !== "ok") {
      const reason =
        outcome.kind === "auth"
          ? "Sign in again to send this bill"
          : outcome.kind === "business_mismatch"
            ? "This bill belongs to another business. Switch back to it to send the bill."
            : outcome.reason;
      // Back to pending exactly as they were: nothing was decided about these bills.
      await repo.patchQueueRows(
        batch.map((r) => ({ clientUuid: r.clientUuid, patch: { status: r.status === "failed" ? ("failed" as const) : ("pending" as const), lastError: reason, lastCode: outcome.kind === "retry" ? "network" : outcome.kind } })),
      );
      if (outcome.kind === "retry") {
        const before = await repo.getMeta<PauseState>(META_SYNC_PAUSE);
        const failures = (before?.failures ?? 0) + 1;
        await repo.setMeta(META_SYNC_PAUSE, { failures, until: now + backoffMs(failures) } satisfies PauseState);
        return { ...summary, state: "unreachable", reason };
      }
      return { ...summary, state: outcome.kind, reason };
    }

    const byId = new Map(outcome.results.map((r) => [r.client_uuid, r]));
    const done = deps.now();
    const patches = batch.map((row) => {
      const result = byId.get(row.clientUuid);
      const kind = classifyResult(result);
      if (kind === "synced" && result) {
        summary.synced += 1;
        const warnings = [...(result.warnings ?? [])];
        if (result.invoiceNumber && result.invoiceNumber !== row.number) {
          warnings.push({ code: "number_differs", message: `The server saved this bill as ${result.invoiceNumber}, not ${row.number}.` });
        }
        return {
          clientUuid: row.clientUuid,
          patch: { status: "synced" as const, syncedAt: done, invoiceId: result.invoiceId ?? null, warnings, lastError: null, lastCode: null },
        };
      }
      if (kind === "conflict" && result) {
        summary.conflicts += 1;
        return {
          clientUuid: row.clientUuid,
          patch: { status: "conflict" as const, attempts: row.attempts + 1, lastError: result.message ?? "The server did not accept this bill", lastCode: result.code ?? "invalid" },
        };
      }
      summary.retried += 1;
      // "deferred" means the server never looked at it: no attempt is counted and it can go again right away.
      if (result?.code === CODE_DEFERRED) {
        return { clientUuid: row.clientUuid, patch: { status: "pending" as const, lastError: null, lastCode: null, nextAttemptAt: done } };
      }
      const attempts = row.attempts + 1;
      return {
        clientUuid: row.clientUuid,
        patch: {
          status: attempts >= MAX_ROW_ATTEMPTS ? ("failed" as const) : ("pending" as const),
          attempts,
          lastError: result?.message ?? "The server did not answer for this bill",
          lastCode: result?.code ?? "server_error",
          nextAttemptAt: done + backoffMs(attempts),
        },
      };
    });
    await repo.patchQueueRows(patches);
    await repo.setMeta(META_LAST_SYNC, done);
    await repo.setMeta(META_SYNC_PAUSE, null);
  }

  await pruneSynced(repo, deps.now());
  return summary;
}

/** Synced bills stay for a week as a short history, then leave the device. Nothing unsynced is ever pruned. */
export async function pruneSynced(repo: OfflineRepo, now: number): Promise<number> {
  const old = (await repo.listQueue()).filter((r) => r.status === "synced" && (r.syncedAt ?? r.createdAt) < now - SYNCED_HISTORY_MS);
  if (old.length > 0) await repo.deleteQueueRows(old.map((r) => r.clientUuid));
  return old.length;
}

// ── Browser pieces ───────────────────────────────────────────────────────────

/** POSTs a batch with the session cookie. Never throws: every failure becomes an outcome. */
export function createFetchSender(businessId: string, fetchImpl: typeof fetch = fetch): SyncDeps["send"] {
  return async (invoices) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      const response = await fetchImpl(SYNC_ENDPOINT, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "manual",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: businessId, invoices } satisfies SyncRequestBody),
        signal: controller.signal,
      });
      // A redirect can only be the sign-in page.
      if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) return { kind: "auth" };
      const kind = classifyHttp(response.status);
      if (kind === "auth" || kind === "business_mismatch") return { kind };
      if (kind === "retry") return { kind, reason: response.status === 429 ? "Too many requests. Trying again shortly." : `The server answered with an error (${response.status})` };
      const body = (await response.json().catch(() => null)) as SyncResponseBody | null;
      if (!body || !Array.isArray(body.results)) return { kind: "retry", reason: "The server sent an answer that could not be read" };
      return { kind: "ok", results: body.results };
    } catch {
      return { kind: "retry", reason: "Could not reach the server" };
    } finally {
      clearTimeout(timer);
    }
  };
}

const LEASE_MS = 90_000;

/**
 * Runs `fn` only if no other tab is syncing this business. Uses the Web Locks
 * API; where it is missing, a short lease in the local database. (A double run
 * would still be harmless, because the server deduplicates on client_uuid.)
 * Returns null when another tab holds the lock.
 */
export async function withSyncLock<T>(repo: OfflineRepo, name: string, fn: () => Promise<T>): Promise<T | null> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (locks?.request) {
    return locks.request(`ekdum.sync.${name}`, { ifAvailable: true }, async (lock) => (lock ? fn() : null));
  }
  const key = "sync.lease";
  const now = Date.now();
  const lease = await repo.getMeta<{ until: number; owner: string }>(key);
  if (lease && lease.until > now) return null;
  const owner = Math.random().toString(36).slice(2);
  await repo.setMeta(key, { until: now + LEASE_MS, owner });
  const mine = await repo.getMeta<{ until: number; owner: string }>(key);
  if (mine?.owner !== owner) return null;
  try {
    return await fn();
  } finally {
    await repo.setMeta(key, null);
  }
}
