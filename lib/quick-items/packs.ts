/**
 * Ready-made sets of quick billing items, added in one tap from Settings or onboarding.
 * The GST rate and HSN are the shop's choice to confirm with its CA: these are the
 * values the shop asked for (imitation jewellery, HSN 7117 at 3%), not tax advice.
 */
export interface QuickItemTemplate {
  name: string;
  gstRate: number;
  hsnCode: string | null;
  unitCode: string;
  priceIncludesTax: boolean;
}

export interface QuickItemPack {
  key: string;
  label: string;
  description: string;
  items: QuickItemTemplate[];
}

const jewellery = (name: string): QuickItemTemplate => ({ name, gstRate: 3, hsnCode: "7117", unitCode: "PCS", priceIncludesTax: false });

export const QUICK_ITEM_PACKS: QuickItemPack[] = [
  {
    key: "jewellery",
    label: "Jewellery",
    description: "Necklace, finger ring, bracelet, earrings and more. GST 3%, HSN 7117, rate before GST.",
    items: [
      "Necklace",
      "Necklace Set",
      "Finger Ring",
      "Bracelet",
      "Earrings",
      "Jhumka",
      "Bangles",
      "Kada",
      "Pendant",
      "Pendant Set",
      "Chain",
      "Mangalsutra",
      "Anklet (Payal)",
      "Toe Ring",
      "Nose Pin",
      "Maang Tikka",
      "Choker",
      "Brooch",
      "Hair Accessories",
      "Jewellery Set",
    ].map(jewellery),
  },
];

export function findPack(key: string): QuickItemPack | undefined {
  return QUICK_ITEM_PACKS.find((p) => p.key === key);
}

/** Templates from a pack that the shop does not have yet (names compared case-insensitively). */
export function missingFromPack(pack: QuickItemPack, existingNames: string[]): QuickItemTemplate[] {
  const have = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  return pack.items.filter((t) => !have.has(t.name.toLowerCase()));
}
