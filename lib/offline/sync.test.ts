import { describe, expect, it } from "vitest";
import type { SaleInput } from "@/lib/validation/sales";
import { fixtureContext, fixtureDevice, fixtureSale, fixtureSeller, OUTLET_ID, uuidOf } from "./fixtures";
import { createMemoryRepo } from "./memory";
import { CODE_DEFERRED, type SyncItemResult } from "./protocol";
import { submitSale } from "./sale";
import {
  BACKOFF_MAX_MS,
  backoffMs,
  classifyHttp,
  classifyResult,
  CONFLICT_CODES,
  MAX_ROW_ATTEMPTS,
  META_SYNC_PAUSE,
  pruneSynced,
  runSync,
  selectBatch,
  SYNCED_HISTORY_MS,
  type SendOutcome,
} from "./sync";
import { META_LAST_SYNC, type QueueRow } from "./types";

const ok = (input: SaleInput, extra: Partial<SyncItemResult> = {}): SyncItemResult => ({
  client_uuid: input.client_uuid,
  ok: true,
  invoiceId: `inv-${input.invoice_number}`,
  invoiceNumber: input.invoice_number ?? undefined,
  duplicate: false,
  warnings: [],
  ...extra,
});
const refuse = (input: SaleInput, code: string, message = code): SyncItemResult => ({ client_uuid: input.client_uuid, ok: false, code, message });

/** A till with `count` bills made offline, and a scripted server. */
async function till(count: number) {
  let clock = Date.parse("2026-11-13T06:00:00Z");
  const repo = createMemoryRepo(() => clock);
  repo.devices.set(OUTLET_ID, fixtureDevice());
  const saleDeps = {
    repo,
    outletId: OUTLET_ID,
    context: fixtureContext(),
    seller: fixtureSeller(),
    printFormat: "thermal_80" as const,
    postOnline: async () => ({ ok: false as const, code: "network", message: "" }),
    isOnline: () => false,
    now: () => new Date(clock),
  };
  for (let i = 1; i <= count; i++) {
    clock += 1000;
    await submitSale(saleDeps, fixtureSale(i));
  }
  const batches: SaleInput[][] = [];
  let server: (batch: SaleInput[]) => SendOutcome | Promise<SendOutcome> = (batch) => ({ kind: "ok", results: batch.map((b) => ok(b)) });
  const deps = {
    repo,
    now: () => clock,
    async send(batch: SaleInput[]) {
      batches.push(batch);
      return server(batch);
    },
  };
  return {
    repo,
    deps,
    batches,
    advance: (ms: number) => (clock += ms),
    serve: (fn: typeof server) => (server = fn),
    row: (n: number) => repo.queue.get(uuidOf(n))!,
    statuses: () => [...repo.queue.values()].sort((a, b) => a.sequence - b.sequence).map((r) => r.status),
  };
}

describe("classifying results", () => {
  it("treats saved bills, including ones saved by an earlier try, as synced", () => {
    expect(classifyResult({ ok: true })).toBe("synced");
    expect(classifyResult({ ok: true, code: undefined })).toBe("synced");
  });

  it("retries temporary trouble", () => {
    for (const code of ["server_error", CODE_DEFERRED, "rate_limited", "network"]) expect(classifyResult({ ok: false, code })).toBe("retry");
    expect(classifyResult(undefined)).toBe("retry");
  });

  it("turns every business rejection into a conflict", () => {
    for (const code of [
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
    ]) {
      expect(CONFLICT_CODES.has(code)).toBe(true);
      expect(classifyResult({ ok: false, code })).toBe("conflict");
    }
  });

  it("shows an unknown rejection to the user instead of retrying it forever", () => {
    expect(classifyResult({ ok: false, code: "something_new" })).toBe("conflict");
    expect(classifyResult({ ok: false })).toBe("conflict");
  });

  it("maps HTTP statuses for the whole batch", () => {
    expect(classifyHttp(200)).toBe("ok");
    expect(classifyHttp(401)).toBe("auth");
    expect(classifyHttp(409)).toBe("business_mismatch");
    for (const status of [408, 413, 429, 500, 502, 503]) expect(classifyHttp(status)).toBe("retry");
  });
});

describe("backoff", () => {
  it("doubles from 5 seconds and stops at 15 minutes", () => {
    expect([1, 2, 3, 4, 5].map(backoffMs)).toEqual([5_000, 10_000, 20_000, 40_000, 80_000]);
    expect(backoffMs(8)).toBe(640_000);
    expect(backoffMs(9)).toBe(BACKOFF_MAX_MS);
    expect(backoffMs(500)).toBe(BACKOFF_MAX_MS);
    expect(backoffMs(0)).toBe(0);
  });
});

describe("choosing the next batch", () => {
  const row = (number: string, patch: Partial<QueueRow> = {}): QueueRow =>
    ({ clientUuid: number, outletId: OUTLET_ID, number, status: "pending", nextAttemptAt: 0, createdAt: 0, attempts: 0, ...patch }) as QueueRow;

  it("sends the oldest number first, across years, and at most the batch size", () => {
    const rows = [row("C1/2728/00001"), row("C1/2627/00010"), row("C1/2627/00002"), row("C1/2627/00003")];
    expect(selectBatch(rows, 100).map((r) => r.number)).toEqual(["C1/2627/00002", "C1/2627/00003", "C1/2627/00010", "C1/2728/00001"]);
    expect(selectBatch(rows, 100, { max: 2 }).map((r) => r.number)).toEqual(["C1/2627/00002", "C1/2627/00003"]);
  });

  it("skips bills that are synced, in conflict, being sent, or have given up", () => {
    const rows = [row("C1/2627/00001", { status: "synced" }), row("C1/2627/00002", { status: "conflict" }), row("C1/2627/00003", { status: "syncing" }), row("C1/2627/00004", { status: "failed" }), row("C1/2627/00005")];
    expect(selectBatch(rows, 100).map((r) => r.number)).toEqual(["C1/2627/00005"]);
    // "Sync now" also retries the ones that had given up.
    expect(selectBatch(rows, 100, { force: true }).map((r) => r.number)).toEqual(["C1/2627/00004", "C1/2627/00005"]);
  });

  it("holds later numbers of a series back while an earlier one waits for its retry time", () => {
    const rows = [row("C1/2627/00001", { nextAttemptAt: 500 }), row("C1/2627/00002"), row("C2/2627/00001")];
    expect(selectBatch(rows, 100).map((r) => r.number)).toEqual(["C2/2627/00001"]);
    expect(selectBatch(rows, 500).map((r) => r.number)).toEqual(["C1/2627/00001", "C1/2627/00002", "C2/2627/00001"]);
    expect(selectBatch(rows, 100, { force: true })).toHaveLength(3);
  });
});

describe("a sync run", () => {
  it("sends bills in number order and marks them synced with the server's id", async () => {
    const t = await till(3);
    const summary = await runSync(t.deps);
    expect(summary).toMatchObject({ state: "done", synced: 3, conflicts: 0 });
    expect(t.batches[0].map((b) => b.invoice_number)).toEqual(["C1/2627/00001", "C1/2627/00002", "C1/2627/00003"]);
    expect(t.statuses()).toEqual(["synced", "synced", "synced"]);
    expect(t.row(2)).toMatchObject({ invoiceId: "inv-C1/2627/00002", lastError: null });
    expect(await t.repo.getMeta(META_LAST_SYNC)).toBe(t.deps.now());
  });

  it("splits a long queue into batches of 25, still in order", async () => {
    const t = await till(60);
    const summary = await runSync(t.deps);
    expect(summary.synced).toBe(60);
    expect(t.batches.map((b) => b.length)).toEqual([25, 25, 10]);
    expect(t.batches[1][0].invoice_number).toBe("C1/2627/00026");
  });

  it("treats 'already saved' as success, so a forced double sync creates no duplicate", async () => {
    const t = await till(2);
    const seen = new Set<string>();
    t.serve((batch) => ({
      kind: "ok",
      results: batch.map((b) => {
        const duplicate = seen.has(b.client_uuid);
        seen.add(b.client_uuid);
        return ok(b, { duplicate });
      }),
    }));
    await runSync(t.deps, { force: true });
    // Pretend the answer was lost and the same bills are sent again.
    await t.repo.patchQueueRows([1, 2].map((n) => ({ clientUuid: uuidOf(n), patch: { status: "pending" as const } })));
    const second = await runSync(t.deps, { force: true });
    expect(second.synced).toBe(2);
    expect(t.statuses()).toEqual(["synced", "synced"]);
    expect(seen.size).toBe(2);
    // Nothing is left to send on a third run.
    await runSync(t.deps, { force: true });
    expect(t.batches).toHaveLength(2);
  });

  it("keeps a refused bill as a conflict with the server's reason, and still syncs the others", async () => {
    const t = await till(3);
    t.serve((batch) => ({ kind: "ok", results: batch.map((b) => (b.client_uuid === uuidOf(2) ? refuse(b, "number_conflict", "Bill number C1/2627/00002 has already been used") : ok(b))) }));
    const summary = await runSync(t.deps);
    expect(summary).toMatchObject({ synced: 2, conflicts: 1 });
    expect(t.statuses()).toEqual(["synced", "conflict", "synced"]);
    expect(t.row(2)).toMatchObject({ lastCode: "number_conflict", lastError: "Bill number C1/2627/00002 has already been used", attempts: 1 });
    // A conflict is never sent again on its own, and never removed.
    await runSync(t.deps, { force: true });
    expect(t.batches).toHaveLength(1);
    expect(t.repo.queue.has(uuidOf(2))).toBe(true);
  });

  it("leaves everything pending when the server cannot be reached, then backs off", async () => {
    const t = await till(2);
    t.serve(() => ({ kind: "retry", reason: "Could not reach the server" }));
    expect(await runSync(t.deps)).toMatchObject({ state: "unreachable", synced: 0 });
    expect(t.statuses()).toEqual(["pending", "pending"]);
    expect(t.row(1)).toMatchObject({ attempts: 0, lastCode: "network" });
    expect(await t.repo.getMeta(META_SYNC_PAUSE)).toMatchObject({ failures: 1, until: t.deps.now() + 5_000 });

    // The timer fires again too early: nothing is sent.
    expect((await runSync(t.deps)).state).toBe("backoff");
    expect(t.batches).toHaveLength(1);
    // After the wait it tries again; a second failure doubles the wait.
    t.advance(5_000);
    await runSync(t.deps);
    expect(await t.repo.getMeta(META_SYNC_PAUSE)).toMatchObject({ failures: 2, until: t.deps.now() + 10_000 });
    // "Sync now" and coming back online ignore the wait. Success clears it.
    t.serve((batch) => ({ kind: "ok", results: batch.map((b) => ok(b)) }));
    expect(await runSync(t.deps, { force: true })).toMatchObject({ state: "done", synced: 2 });
    expect(await t.repo.getMeta(META_SYNC_PAUSE)).toBeFalsy();
  });

  it("also survives a sender that throws", async () => {
    const t = await till(1);
    t.serve(() => {
      throw new Error("boom");
    });
    expect((await runSync(t.deps)).state).toBe("unreachable");
    expect(t.statuses()).toEqual(["pending"]);
  });

  it("pauses without touching the queue when the user is signed out", async () => {
    const t = await till(2);
    const before = JSON.stringify([...t.repo.queue.values()].map((r) => r.input));
    t.serve(() => ({ kind: "auth" }));
    expect(await runSync(t.deps)).toMatchObject({ state: "auth", synced: 0 });
    expect(t.statuses()).toEqual(["pending", "pending"]);
    expect(t.row(1).attempts).toBe(0);
    expect(JSON.stringify([...t.repo.queue.values()].map((r) => r.input))).toBe(before);
    // Being signed out is not a reason to back off.
    expect(await t.repo.getMeta(META_SYNC_PAUSE)).toBeFalsy();
  });

  it("pauses when the session is on another business", async () => {
    const t = await till(1);
    t.serve(() => ({ kind: "business_mismatch" }));
    expect((await runSync(t.deps)).state).toBe("business_mismatch");
    expect(t.statuses()).toEqual(["pending"]);
  });

  it("retries a bill the server choked on, with backoff, without sending later numbers ahead of it", async () => {
    const t = await till(3);
    t.serve((batch) => ({
      kind: "ok",
      results: batch.map((b, i) => (i === 0 ? refuse(b, "server_error", "Could not save the bill") : refuse(b, CODE_DEFERRED))),
    }));
    const summary = await runSync(t.deps);
    expect(summary).toMatchObject({ state: "done", synced: 0, retried: 3 });
    expect(t.batches).toHaveLength(1);
    expect(t.row(1)).toMatchObject({ status: "pending", attempts: 1, nextAttemptAt: t.deps.now() + 5_000 });
    // Deferred bills were never looked at: no attempt is counted.
    expect(t.row(2)).toMatchObject({ status: "pending", attempts: 0 });

    // Before bill 1 is due, bills 2 and 3 stay behind it.
    await runSync(t.deps);
    expect(t.batches).toHaveLength(1);
    t.advance(5_000);
    t.serve((batch) => ({ kind: "ok", results: batch.map((b) => ok(b)) }));
    await runSync(t.deps);
    expect(t.batches[1].map((b) => b.invoice_number)).toEqual(["C1/2627/00001", "C1/2627/00002", "C1/2627/00003"]);
    expect(t.statuses()).toEqual(["synced", "synced", "synced"]);
  });

  it("stops trying on its own after repeated server errors, but keeps the bill for a manual retry", async () => {
    const t = await till(1);
    t.serve((batch) => ({ kind: "ok", results: batch.map((b) => refuse(b, "server_error")) }));
    for (let i = 0; i < MAX_ROW_ATTEMPTS; i++) {
      await runSync(t.deps);
      t.advance(BACKOFF_MAX_MS);
    }
    expect(t.row(1)).toMatchObject({ status: "failed", attempts: MAX_ROW_ATTEMPTS });
    const sent = t.batches.length;
    await runSync(t.deps);
    expect(t.batches).toHaveLength(sent);
    t.serve((batch) => ({ kind: "ok", results: batch.map((b) => ok(b)) }));
    await runSync(t.deps, { force: true });
    expect(t.row(1).status).toBe("synced");
  });

  it("retries a bill the server gave no answer for", async () => {
    const t = await till(2);
    t.serve((batch) => ({ kind: "ok", results: [ok(batch[0])] }));
    await runSync(t.deps);
    expect(t.statuses()).toEqual(["synced", "pending"]);
    expect(t.row(2).attempts).toBe(1);
  });

  it("recovers bills left in 'syncing' by a run that died", async () => {
    const t = await till(1);
    await t.repo.patchQueueRows([{ clientUuid: uuidOf(1), patch: { status: "syncing" } }]);
    await runSync(t.deps);
    expect(t.row(1).status).toBe("synced");
  });

  it("notes when the server stored a different number", async () => {
    const t = await till(1);
    t.serve((batch) => ({ kind: "ok", results: batch.map((b) => ok(b, { invoiceNumber: "C1/2627/00099", duplicate: true })) }));
    await runSync(t.deps);
    expect(t.row(1).warnings.map((w) => w.code)).toEqual(["number_differs"]);
  });

  it("never drops unsynced rows when pruning", async () => {
    const t = await till(3);
    t.serve((batch) => ({ kind: "ok", results: batch.map((b) => (b.client_uuid === uuidOf(3) ? refuse(b, "invalid") : ok(b))) }));
    await runSync(t.deps);
    t.advance(SYNCED_HISTORY_MS + 1);
    expect(await pruneSynced(t.repo, t.deps.now())).toBe(2);
    expect([...t.repo.queue.keys()]).toEqual([uuidOf(3)]);
    expect(t.row(3).status).toBe("conflict");
  });

  it("keeps synced bills for a week as history", async () => {
    const t = await till(1);
    await runSync(t.deps);
    t.advance(SYNCED_HISTORY_MS - 1000);
    await runSync(t.deps);
    expect(t.repo.queue.size).toBe(1);
    t.advance(2000);
    await runSync(t.deps);
    expect(t.repo.queue.size).toBe(0);
  });
});
