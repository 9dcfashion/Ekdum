import { expect, test, type Page } from "@playwright/test";

/**
 * Offline POS, end to end: bill with no network on a registered device, see it
 * queued with the device's own number, come back online, see it synced and in
 * Sales with the same number, and prove a forced second sync makes no duplicate.
 *
 * Needs a running app with a real Supabase project and an OWNER account that has
 * finished onboarding and has at least one product in stock:
 *   E2E_BASE_URL=http://localhost:3000 E2E_EMAIL=owner@example.com E2E_PASSWORD=… pnpm test:e2e offline
 * Each run registers this (fresh) browser as a new POS device with a random prefix.
 */
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

test.skip(!process.env.E2E_BASE_URL || !EMAIL || !PASSWORD, "Set E2E_BASE_URL, E2E_EMAIL and E2E_PASSWORD to run the offline POS test");

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const randomPrefix = () => `E${Array.from({ length: 3 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join("")}`;

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL!);
  await page.getByLabel("Password").fill(PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/app\//);
}

async function registerDevice(page: Page, prefix: string) {
  await page.goto("/app/settings/devices");
  await page.getByLabel("Device name").fill(`E2E counter ${prefix}`);
  await page.getByLabel("Series prefix").fill(prefix);
  await expect(page.getByText(`First bill: ${prefix}/`)).toBeVisible();
  await page.getByRole("button", { name: "Register this device" }).click();
  await expect(page.getByText("Next bill number")).toBeVisible();
  await expect(page.getByText(new RegExp(`^${prefix}/\\d{4}/00001$`))).toBeVisible();
}

/** The queued bills as stored in this browser's IndexedDB. */
async function readQueue(page: Page) {
  return page.evaluate(async () => {
    const databases = await indexedDB.databases();
    const name = databases.map((d) => d.name ?? "").find((n) => n.startsWith("ekdum-pos-"));
    if (!name) return [];
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Array<{ number: string; status: string; input: unknown }>>((resolve, reject) => {
        const request = db.transaction("queue", "readonly").objectStore("queue").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });
}

test("a bill made offline is queued, synced once and shows up in Sales with the same number", async ({ page, context }) => {
  const prefix = randomPrefix();
  await signIn(page);
  await registerDevice(page, prefix);

  // Open the POS online once: the catalog is saved on the device.
  await page.goto("/app/pos");
  const search = page.getByLabel("Search or scan an item");
  await expect(search).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Online" })).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const databases = await indexedDB.databases();
        return databases.some((d) => (d.name ?? "").startsWith("ekdum-pos-"));
      }),
    )
    .toBe(true);

  // ── Go offline and make a bill ──
  await context.setOffline(true);
  await expect(page.getByRole("status").filter({ hasText: "Offline" }).first()).toBeVisible();

  await search.fill("a");
  await page.getByRole("listbox", { name: "Matching items" }).getByRole("option").first().click();
  await page.keyboard.press("F9");
  await page.getByRole("button", { name: "Exact cash" }).click();
  await page.getByRole("button", { name: /Save bill/ }).click();

  // "Saved offline" is clearly not "posted", and the number is the device's own.
  const saved = page.getByRole("dialog", { name: "Saved offline, will sync" });
  await expect(saved).toBeVisible();
  await expect(saved.getByText("Saved offline, will sync.")).toBeVisible();
  const number = (await saved.getByText(new RegExp(`^${prefix}/\\d{4}/00001$`)).textContent())!.trim();
  await saved.getByRole("button", { name: /New bill/ }).click();

  await expect(page.getByRole("button", { name: /Pending bills: 1 waiting to sync/ })).toBeVisible();
  const queued = await readQueue(page);
  expect(queued).toHaveLength(1);
  expect(queued[0]).toMatchObject({ number, status: "pending" });

  // The pending list shows it, and the slip can be opened with no network.
  await page.getByRole("button", { name: /Pending bills/ }).click();
  const panel = page.getByRole("dialog", { name: "Pending and conflicts" });
  await expect(panel.getByText(number)).toBeVisible();
  await expect(panel.getByText("Waiting to sync").first()).toBeVisible();
  await panel.getByRole("button", { name: "View / print" }).click();
  await expect(page.getByRole("article", { name: new RegExp(number) }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // ── Back online: it syncs by itself ──
  await context.setOffline(false);
  await expect(page.getByRole("button", { name: /Pending bills: 0 waiting to sync, 0 need attention/ })).toBeVisible({ timeout: 30_000 });
  const synced = await readQueue(page);
  expect(synced[0]).toMatchObject({ number, status: "synced" });

  // ── Forced double sync: the same payload again must return the same invoice, not a new one ──
  const replay = await page.evaluate(async (invoice) => {
    const businessId = (await indexedDB.databases()).map((d) => d.name ?? "").find((n) => n.startsWith("ekdum-pos-"))!.replace("ekdum-pos-", "");
    const response = await fetch("/api/pos/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_id: businessId, invoices: [invoice, invoice] }),
    });
    return { status: response.status, body: (await response.json()) as { results: Array<{ ok: boolean; duplicate?: boolean; invoiceNumber?: string; invoiceId?: string }> } };
  }, synced[0].input);
  expect(replay.status).toBe(200);
  expect(replay.body.results).toHaveLength(2);
  for (const result of replay.body.results) expect(result).toMatchObject({ ok: true, duplicate: true, invoiceNumber: number });
  expect(replay.body.results[0].invoiceId).toBe(replay.body.results[1].invoiceId);
  // The answer never carries the device key.
  expect(JSON.stringify(replay.body)).not.toContain("key");

  await page.getByRole("button", { name: "Sync now" }).first().click();

  // ── Sales shows exactly one bill with that number ──
  await page.goto(`/app/sales?q=${encodeURIComponent(number)}`);
  await expect(page.getByText(number, { exact: true })).toHaveCount(1);
});

test("signed out, the sync endpoint refuses and nothing is posted", async ({ request }) => {
  const response = await request.post("/api/pos/sync", { data: { business_id: "00000000-0000-4000-8000-000000000000", invoices: [] } });
  expect(response.status()).toBe(401);
});
