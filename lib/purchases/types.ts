/** Shapes shared by the purchase pages, components and Server Actions. */

export interface VendorOption {
  id: string;
  name: string;
  gstin: string | null;
  state_code: string | null;
  phone?: string | null;
}

export interface OutletOption {
  id: string;
  name: string;
  /** This business's state for tax purposes at that outlet (GSTIN state, else address state). */
  ourState: string;
}

export interface UnitOption {
  code: string;
  name: string;
}

export interface GstRateOption {
  rate: number;
  label: string;
  is_active: boolean;
}

export interface PurchaseProductOption {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  hsn_code: string | null;
  unit_code: string;
  gst_rate: number;
  cess_rate: number;
  /** Last purchase price per unit before tax. Null when unknown or the user may not see costs. */
  cost_paise: number | null;
  /** Stock at the bill's outlet. Null when not tracked, unknown, or the user may not see stock. */
  stock: number | null;
}

export interface ProductSuggestions {
  /** "vendor": bought from this supplier before; "recent": bought recently from anyone. */
  source: "vendor" | "recent";
  results: PurchaseProductOption[];
}

export interface ProductSearchResult {
  results: PurchaseProductOption[];
  /** Set when the search text is exactly one product's barcode or SKU (a scan). */
  exactId: string | null;
}

export interface SaveBillResult {
  id: string;
  posted: boolean;
  /** Set when the draft was saved but posting was refused. */
  postError: string | null;
}
