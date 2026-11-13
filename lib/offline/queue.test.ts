import { describe, expect, it } from "vitest";
import type { CatalogProduct, PosCustomer } from "@/lib/pos/types";
import { describeAge } from "./age";
import { matchCustomers } from "./customers";
import { fixtureContext, fixtureDevice, fixtureSale, fixtureSeller, OUTLET_ID, PRODUCT_ID, uuidOf } from "./fixtures";
import { createMemoryRepo } from "./memory";
import { applyStockDeltas, countQueue, discardBill, QueueActionError, reissueBill, retryBill, subtractUnsynced } from "./queue";
import { buildLocalBill } from "./receipt";
import { submitSale } from "./sale";

const product = (overrides: Partial<CatalogProduct> = {}): CatalogProduct => ({
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
  ...overrides,
});

async function tillWithBills(count: number) {
  const repo = createMemoryRepo(() => 1000);
  repo.devices.set(OUTLET_ID, fixtureDevice());
  const deps = {
    repo,
    outletId: OUTLET_ID,
    context: fixtureContext(),
    seller: fixtureSeller(),
    printFormat: "thermal_80" as const,
    postOnline: async () => ({ ok: false as const, code: "network", message: "" }),
    isOnline: () => false,
    now: () => new Date("2026-11-13T06:00:00Z"),
  };
  for (let i = 1; i <= count; i++) await submitSale(deps, fixtureSale(i));
  return repo;
}

describe("stock on the device", () => {
  it("takes sold quantities off tracked products only", () => {
    const catalog = [product(), product({ id: "other", stock: 4 }), product({ id: "untracked", track_inventory: false, stock: null })];
    const next = applyStockDeltas(catalog, [
      { productId: PRODUCT_ID, quantity: "2" },
      { productId: PRODUCT_ID, quantity: "0.250" },
      { productId: "untracked", quantity: "5" },
    ]);
    expect(next.map((p) => p.stock)).toEqual([7.75, 4, null]);
    expect(applyStockDeltas(catalog, [])).toBe(catalog);
  });

  it("takes bills still waiting on the device off a catalog fresh from the server", async () => {
    const repo = await tillWithBills(3);
    await repo.patchQueueRows([{ clientUuid: uuidOf(1), patch: { status: "synced" } }, { clientUuid: uuidOf(2), patch: { status: "conflict" } }]);
    // Bill 1 is on the server already (its stock is in the fresh catalog); bills 2 and 3 are not.
    const adjusted = subtractUnsynced([product()], await repo.listQueue(), OUTLET_ID);
    expect(adjusted[0].stock).toBe(6);
    expect(subtractUnsynced([product()], await repo.listQueue(), "another-outlet")[0].stock).toBe(10);
  });
});

describe("counting", () => {
  it("separates waiting bills from those that need a person", async () => {
    const repo = await tillWithBills(4);
    await repo.patchQueueRows([
      { clientUuid: uuidOf(1), patch: { status: "synced" } },
      { clientUuid: uuidOf(2), patch: { status: "conflict" } },
      { clientUuid: uuidOf(3), patch: { status: "syncing" } },
    ]);
    expect(countQueue(await repo.listQueue())).toEqual({ pending: 2, attention: 1, synced: 1 });
  });
});

describe("resolving a conflict", () => {
  it("retry puts the bill back in line unchanged", async () => {
    const repo = await tillWithBills(1);
    await repo.patchQueueRows([{ clientUuid: uuidOf(1), patch: { status: "conflict", lastCode: "insufficient_stock", nextAttemptAt: 9e15 } }]);
    await retryBill(repo, uuidOf(1));
    expect(repo.queue.get(uuidOf(1))).toMatchObject({ status: "pending", nextAttemptAt: 0, number: "C1/2627/00001" });
  });

  it("re-issue gives a number-conflict bill the device's next number, on the bill and on its slip", async () => {
    const repo = await tillWithBills(2);
    await repo.patchQueueRows([{ clientUuid: uuidOf(1), patch: { status: "conflict", lastCode: "number_conflict", lastError: "used", attempts: 1 } }]);
    const row = await reissueBill(repo, uuidOf(1));
    expect(row).toMatchObject({ number: "C1/2627/00003", sequence: 3, status: "pending", attempts: 0, lastCode: null, reissuedFrom: "C1/2627/00001" });
    expect(row.input.invoice_number).toBe("C1/2627/00003");
    expect(row.input.client_uuid).toBe(uuidOf(1));
    expect(row.receipt.number).toBe("C1/2627/00003");
    expect(row.receipt.upi?.uri).toContain("C1%2F2627%2F00003");
    expect(row.receipt.upi?.uri).not.toContain("00001");
    expect(repo.devices.get(OUTLET_ID)!.counters).toEqual({ "2627": 4 });
  });

  it("re-issue is refused for anything but a number conflict, and nothing changes", async () => {
    const repo = await tillWithBills(1);
    await expect(reissueBill(repo, uuidOf(1))).rejects.toBeInstanceOf(QueueActionError);
    await repo.patchQueueRows([{ clientUuid: uuidOf(1), patch: { status: "conflict", lastCode: "insufficient_stock" } }]);
    await expect(reissueBill(repo, uuidOf(1))).rejects.toBeInstanceOf(QueueActionError);
    expect(repo.queue.get(uuidOf(1))!.number).toBe("C1/2627/00001");
    expect(repo.devices.get(OUTLET_ID)!.counters).toEqual({ "2627": 2 });
  });

  it("discard needs the bill number typed exactly, and only works on a refused bill", async () => {
    const repo = await tillWithBills(2);
    await expect(discardBill(repo, uuidOf(1), "C1/2627/00001")).rejects.toThrow("Only a bill the server refused");
    await repo.patchQueueRows([{ clientUuid: uuidOf(1), patch: { status: "conflict", lastCode: "invalid" } }]);
    await expect(discardBill(repo, uuidOf(1), "C1/2627/00002")).rejects.toThrow("does not match");
    await expect(discardBill(repo, uuidOf(1), "")).rejects.toThrow("does not match");
    expect(repo.queue.size).toBe(2);
    await discardBill(repo, uuidOf(1), " c1/2627/00001 ");
    expect([...repo.queue.keys()]).toEqual([uuidOf(2)]);
  });
});

describe("the bill printed from local data", () => {
  const at = new Date("2026-11-13T06:00:00Z");
  const numbered = (n = 1) => ({ ...fixtureSale(n), device: { id: fixtureDevice().deviceId, key: fixtureDevice().key }, invoice_number: "C1/2627/00001", invoice_date: "2026-11-13" });

  it("has the number, date, lines, tax split, payments and UPI link of the bill", () => {
    const bill = buildLocalBill(numbered(), fixtureContext(), fixtureSeller(), at);
    if (!bill.ok) throw new Error(bill.message);
    const v = bill.view;
    expect(v).toMatchObject({ number: "C1/2627/00001", date: "13/11/2026", title: "Tax Invoice", interState: false, amountDuePaise: 0 });
    expect(v.seller).toMatchObject({ name: "Sharma Kirana", gstin: "27AAPFU0939F1ZV" });
    expect(v.totals).toMatchObject({ taxablePaise: 200_00, cgstPaise: 18_00, sgstPaise: 18_00, totalPaise: 236_00 });
    expect(v.lines[0]).toMatchObject({ description: "Basmati rice 1kg", quantity: "2", totalPaise: 236_00 });
    expect(v.payments).toMatchObject([{ mode: "cash", amountPaise: 236_00 }]);
    expect(v.upi?.uri).toContain("C1%2F2627%2F00001");
    // Bank details never travel to the till.
    expect(v.bank).toBeNull();
  });

  it("refuses totals that do not match the engine, and bills without a number", () => {
    const wrong = numbered();
    wrong.totals = { ...wrong.totals, totalPaise: wrong.totals.totalPaise + 100 };
    expect(buildLocalBill(wrong, fixtureContext(), fixtureSeller(), at)).toMatchObject({ ok: false, code: "totals_mismatch" });
    expect(buildLocalBill(fixtureSale(1), fixtureContext(), fixtureSeller(), at)).toMatchObject({ ok: false, code: "number_invalid" });
  });

  it("asks for the customer's details on a bill of ₹50,000 or more, like the server does online", () => {
    const big = { ...fixtureSale(1, { quantity: "500" }), invoice_number: "C1/2627/00001", invoice_date: "2026-11-13" };
    expect(buildLocalBill(big, fixtureContext(), fixtureSeller(), at)).toMatchObject({ ok: false, code: "invalid" });
    const named = { ...big, customer: { name: "Ravi", phone: null, email: null, gstin: null, address: "4 Park Street", pincode: null, state_code: "27" } };
    expect(buildLocalBill(named, fixtureContext(), fixtureSeller(), at).ok).toBe(true);
  });
});

describe("customer lookup on the device", () => {
  const c = (id: string, name: string, phone: string | null, gstin: string | null = null): PosCustomer => ({
    id,
    name,
    phone,
    email: null,
    gstin,
    address: null,
    pincode: null,
    state_code: null,
    whatsapp_opt_in: false,
  });
  const list = [c("1", "Ravi Kumar", "+919876543210"), c("2", "Anita Traders", "+919812345678", "27AAPFU0939F1ZV"), c("3", "Zed", null)];

  it("matches name, the last digits of the phone, or the start of the GSTIN", () => {
    expect(matchCustomers(list, "ravi").map((x) => x.id)).toEqual(["1"]);
    expect(matchCustomers(list, "98123").map((x) => x.id)).toEqual(["2"]);
    expect(matchCustomers(list, "+91 98765 43210").map((x) => x.id)).toEqual(["1"]);
    expect(matchCustomers(list, "27aapfu").map((x) => x.id)).toEqual(["2"]);
    expect(matchCustomers(list, "r")).toEqual([]);
    expect(matchCustomers(list, "a", 1)).toEqual([]);
  });
});

describe("ages", () => {
  it("reads like a person would say it", () => {
    const now = 10 * 24 * 60 * 60_000;
    expect(describeAge(null, now)).toBe("never");
    expect(describeAge(now - 20_000, now)).toBe("just now");
    expect(describeAge(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(describeAge(now - 3 * 60 * 60_000, now)).toBe("3 h ago");
    expect(describeAge(now - 24 * 60 * 60_000, now)).toBe("1 day ago");
    expect(describeAge(now - 3 * 24 * 60 * 60_000, now)).toBe("3 days ago");
  });
});
