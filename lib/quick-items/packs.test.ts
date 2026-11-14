import { describe, expect, it } from "vitest";
import { QUICK_ITEM_PACKS, findPack, missingFromPack } from "./packs";

describe("quick item packs", () => {
  it("the jewellery pack bills at 3% GST under HSN 7117, rate before GST", () => {
    const pack = findPack("jewellery")!;
    expect(pack.items.length).toBeGreaterThanOrEqual(15);
    expect(pack.items.map((i) => i.name)).toEqual(expect.arrayContaining(["Necklace", "Finger Ring", "Bracelet", "Earrings"]));
    expect(pack.items.every((i) => i.gstRate === 3 && i.hsnCode === "7117" && i.unitCode === "PCS" && !i.priceIncludesTax)).toBe(true);
  });

  it("every pack has unique names that fit the database limits", () => {
    for (const pack of QUICK_ITEM_PACKS) {
      const names = pack.items.map((i) => i.name.toLowerCase());
      expect(new Set(names).size).toBe(names.length);
      expect(pack.items.every((i) => i.name.length <= 60)).toBe(true);
    }
  });

  it("adds only what is missing, ignoring case and spaces", () => {
    const pack = findPack("jewellery")!;
    const missing = missingFromPack(pack, [" necklace ", "FINGER RING"]);
    expect(missing.map((i) => i.name)).not.toContain("Necklace");
    expect(missing.map((i) => i.name)).not.toContain("Finger Ring");
    expect(missing).toHaveLength(pack.items.length - 2);
  });
});
