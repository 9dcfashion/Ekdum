import { describe, expect, it } from "vitest";
import type { SubmitSaleResult } from "@/lib/pos/types";
import type { SaleInput } from "@/lib/validation/sales";
import { fixtureContext, fixtureDevice, fixtureSale, fixtureSeller, OUTLET_ID, PRODUCT_ID, uuidOf } from "./fixtures";
import { createMemoryRepo } from "./memory";
import { submitSale, type SaleDeps } from "./sale";

const posted = (input: SaleInput): SubmitSaleResult => ({
  ok: true,
  invoiceId: "99999999-9999-4999-8999-999999999999",
  invoiceNumber: input.invoice_number ?? "A/2627/00001",
  publicToken: "t",
  duplicate: false,
  warnings: [],
});
const NETWORK: SubmitSaleResult = { ok: false, code: "network", message: "no network" };

function setup(opts: { registered?: boolean; online?: boolean; answers?: Array<SubmitSaleResult | "ok">; at?: string } = {}) {
  const repo = createMemoryRepo(() => 1_000);
  if (opts.registered !== false) repo.devices.set(OUTLET_ID, fixtureDevice());
  const sent: SaleInput[] = [];
  const answers = [...(opts.answers ?? [])];
  let online = opts.online ?? true;
  let clock = new Date(opts.at ?? "2026-11-13T06:00:00Z");
  const deps: SaleDeps = {
    repo,
    outletId: OUTLET_ID,
    context: fixtureContext(),
    seller: fixtureSeller(),
    printFormat: "thermal_80",
    async postOnline(input) {
      sent.push(input);
      const answer = answers.shift() ?? "ok";
      return answer === "ok" ? posted(input) : answer;
    },
    isOnline: () => online,
    now: () => clock,
    fetchServerSeries: async () => ({ active: true, series: [{ fy: "2627", next: 7 }] }),
  };
  return {
    repo,
    deps,
    sent,
    setOnline: (value: boolean) => (online = value),
    setClock: (iso: string) => (clock = new Date(iso)),
  };
}

describe("a browser that is not a registered device", () => {
  it("posts online with the outlet's series, exactly like before", async () => {
    const t = setup({ registered: false });
    const result = await submitSale(t.deps, fixtureSale(1));
    expect(result.ok).toBe(true);
    expect(t.sent[0].device).toBeUndefined();
    expect(t.sent[0].invoice_number).toBeUndefined();
    expect(t.repo.queue.size).toBe(0);
  });

  it("refuses to bill offline and says how to fix it", async () => {
    const t = setup({ registered: false, online: false });
    const result = await submitSale(t.deps, fixtureSale(1));
    expect(result).toMatchObject({ ok: false, code: "offline_unavailable" });
    expect(!result.ok && result.message).toContain("Register this device in Settings → POS devices to bill offline");
    expect(t.sent).toHaveLength(0);
  });

  it("does not queue when the network fails mid-post", async () => {
    const t = setup({ registered: false, answers: [NETWORK] });
    const result = await submitSale(t.deps, fixtureSale(1));
    expect(result).toMatchObject({ ok: false, code: "network" });
    expect(t.repo.queue.size).toBe(0);
  });
});

describe("a registered device, offline", () => {
  it("numbers the bill, queues it with the device key and prints from local data", async () => {
    const t = setup({ online: false });
    const result = await submitSale(t.deps, fixtureSale(1));
    expect(result).toMatchObject({ ok: true, queued: true, invoiceNumber: "C1/2627/00001", invoiceId: `offline:${uuidOf(1)}` });
    const row = t.repo.queue.get(uuidOf(1))!;
    expect(row.status).toBe("pending");
    expect(row.input.invoice_number).toBe("C1/2627/00001");
    expect(row.input.invoice_date).toBe("2026-11-13");
    expect(row.input.device).toEqual({ id: fixtureDevice().deviceId, key: fixtureDevice().key });
    expect(row.receipt.number).toBe("C1/2627/00001");
    expect(row.receipt.date).toBe("13/11/2026");
    expect(row.receipt.totals.totalPaise).toBe(236_00);
    expect(row.receipt.lines).toHaveLength(1);
    expect(row.receipt.upi?.uri).toContain("am=236.00");
    expect(t.sent).toHaveLength(0);
  });

  it("issues consecutive numbers, and the counter moves only with a saved bill", async () => {
    const t = setup({ online: false });
    await submitSale(t.deps, fixtureSale(1));
    await submitSale(t.deps, fixtureSale(2));
    expect([...t.repo.queue.values()].map((r) => r.number)).toEqual(["C1/2627/00001", "C1/2627/00002"]);

    // A bill that cannot be saved (payments do not add up) takes no number.
    const bad = fixtureSale(3);
    bad.payments = [{ mode: "cash", amount_paise: 1, reference: null }];
    const result = await submitSale(t.deps, bad);
    expect(result.ok).toBe(false);
    expect(t.repo.devices.get(OUTLET_ID)!.counters).toEqual({ "2627": 3 });
    expect(t.repo.queue.size).toBe(2);
  });

  it("is idempotent: pressing Pay twice for the same bill keeps one row and one number", async () => {
    const t = setup({ online: false });
    const first = await submitSale(t.deps, fixtureSale(1));
    const second = await submitSale(t.deps, fixtureSale(1));
    expect(second).toMatchObject({ ok: true, invoiceNumber: first.ok && first.invoiceNumber });
    expect(t.repo.queue.size).toBe(1);
    expect(t.repo.devices.get(OUTLET_ID)!.counters).toEqual({ "2627": 2 });
  });

  it("uses the IST date: a bill at 00:10 IST on 1 April starts the new year's series", async () => {
    // 31 March 18:40 UTC is 1 April 00:10 IST.
    const t = setup({ online: false, at: "2027-03-31T18:40:00Z" });
    t.repo.devices.set(OUTLET_ID, fixtureDevice({ counters: { "2627": 500 } }));
    const result = await submitSale(t.deps, fixtureSale(1));
    expect(result).toMatchObject({ ok: true, invoiceNumber: "C1/2728/00001" });
    expect(t.repo.queue.get(uuidOf(1))!.input.invoice_date).toBe("2027-04-01");
  });

  it("takes sold stock off the saved catalog", async () => {
    const t = setup({ online: false });
    await t.repo.saveCatalog(
      OUTLET_ID,
      [
        {
          id: PRODUCT_ID,
          name: "Basmati rice 1kg",
          sku: null,
          barcode: null,
          hsn_code: "1006",
          unit_code: "PCS",
          allow_decimal: false,
          gst_rate: 18,
          cess_rate: 0,
          sale_price_paise: 118_00,
          price_includes_tax: true,
          track_inventory: true,
          stock: 10,
        },
      ],
      { version: "v1", savedAt: 0, count: 1 },
    );
    await submitSale(t.deps, fixtureSale(1));
    await submitSale(t.deps, fixtureSale(1)); // the same bill again must not count twice
    expect((await t.repo.loadCatalog(OUTLET_ID))[0].stock).toBe(8);
  });

  it("refuses a bill the server would refuse later, before it is printed", async () => {
    const t = setup({ online: false });
    const credit = fixtureSale(1);
    credit.payments = [{ mode: "credit", amount_paise: 236_00, reference: null }];
    const result = await submitSale(t.deps, credit);
    expect(result).toMatchObject({ ok: false, code: "invalid" });
    expect(t.repo.queue.size).toBe(0);
  });

  it("treats a deactivated device as not registered", async () => {
    const t = setup({ online: false });
    t.repo.devices.set(OUTLET_ID, fixtureDevice({ revoked: true }));
    expect(await submitSale(t.deps, fixtureSale(1))).toMatchObject({ ok: false, code: "offline_unavailable" });
  });
});

describe("a registered device, online", () => {
  it("posts with its own number and device key, and queues nothing", async () => {
    const t = setup();
    const result = await submitSale(t.deps, fixtureSale(1));
    expect(result).toMatchObject({ ok: true, invoiceNumber: "C1/2627/00001" });
    expect(result.ok && result.queued).toBeFalsy();
    expect(t.sent[0]).toMatchObject({ invoice_number: "C1/2627/00001", invoice_date: "2026-11-13", device: { id: fixtureDevice().deviceId } });
    expect(t.repo.queue.size).toBe(0);
    expect(t.repo.devices.get(OUTLET_ID)).toMatchObject({ counters: { "2627": 2 }, reservations: {} });
  });

  it("falls back to the queue on a network failure, with the SAME client_uuid and number", async () => {
    const t = setup({ answers: [NETWORK] });
    const result = await submitSale(t.deps, fixtureSale(1));
    expect(result).toMatchObject({ ok: true, queued: true, invoiceNumber: "C1/2627/00001" });
    const row = t.repo.queue.get(uuidOf(1))!;
    expect(row.input.client_uuid).toBe(t.sent[0].client_uuid);
    expect(row.input.invoice_number).toBe(t.sent[0].invoice_number);
    expect(t.repo.devices.get(OUTLET_ID)).toMatchObject({ counters: { "2627": 2 }, reservations: {} });
  });

  it("never queues a bill the server rejected, and hands its number to the next bill", async () => {
    const t = setup({ answers: [{ ok: false, code: "insufficient_stock", message: "Not enough stock" }] });
    const rejected = await submitSale(t.deps, fixtureSale(1));
    expect(rejected).toEqual({ ok: false, code: "insufficient_stock", message: "Not enough stock" });
    expect(t.repo.queue.size).toBe(0);
    // The cashier fixes the bill and pays again: same number, no gap.
    const retried = await submitSale(t.deps, fixtureSale(1));
    expect(retried).toMatchObject({ ok: true, invoiceNumber: "C1/2627/00001" });
  });

  it("on a number conflict for an unprinted bill: catches up with the server and retries once with a fresh number", async () => {
    const t = setup({ answers: [{ ok: false, code: "number_conflict", message: "used" }, "ok"] });
    const result = await submitSale(t.deps, fixtureSale(1));
    // The server's series says next = 7.
    expect(result).toMatchObject({ ok: true, invoiceNumber: "C1/2627/00007" });
    expect(t.sent.map((s) => s.invoice_number)).toEqual(["C1/2627/00001", "C1/2627/00007"]);
    expect(t.sent[1].client_uuid).toBe(t.sent[0].client_uuid);
    expect(t.repo.devices.get(OUTLET_ID)!.counters).toEqual({ "2627": 8 });
  });

  it("gives up after one retry of a number conflict and shows the error", async () => {
    const conflict: SubmitSaleResult = { ok: false, code: "number_conflict", message: "used" };
    const t = setup({ answers: [conflict, conflict] });
    expect(await submitSale(t.deps, fixtureSale(1))).toMatchObject({ ok: false, code: "number_conflict" });
    expect(t.sent).toHaveLength(2);
    expect(t.repo.queue.size).toBe(0);
    // A number the server says is taken is never offered again.
    expect(t.repo.devices.get(OUTLET_ID)).toMatchObject({ counters: { "2627": 8 }, reservations: {} });
  });

  it("keeps billing online with the outlet's series when the owner deactivated the device", async () => {
    const t = setup({ answers: [{ ok: false, code: "device_invalid", message: "deactivated" }, "ok"] });
    const result = await submitSale(t.deps, fixtureSale(1));
    expect(result.ok).toBe(true);
    expect(t.sent[1].device).toBeUndefined();
    expect(t.sent[1].invoice_number).toBeUndefined();
    expect(t.repo.devices.get(OUTLET_ID)).toMatchObject({ revoked: true, counters: { "2627": 1 } });
  });

  it("does not post a bill a second way once it is in the queue", async () => {
    const t = setup({ online: false });
    await submitSale(t.deps, fixtureSale(1));
    t.setOnline(true);
    const again = await submitSale(t.deps, fixtureSale(1));
    expect(again).toMatchObject({ ok: true, queued: true, invoiceNumber: "C1/2627/00001" });
    expect(t.sent).toHaveLength(0);
  });
});
