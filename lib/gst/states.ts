/** GST state / UT codes (first two digits of a GSTIN). */
export interface GstState {
  code: string;
  name: string;
  /** Legacy codes are valid on old GSTINs but should not be offered for new addresses. */
  legacy?: boolean;
  /** Special codes that are not a physical state. */
  special?: boolean;
}

export const GST_STATES: readonly GstState[] = [
  { code: "01", name: "Jammu and Kashmir" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" },
  { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" },
  { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" },
  { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" },
  { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" },
  { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "24", name: "Gujarat" },
  { code: "25", name: "Daman and Diu (old)", legacy: true },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "27", name: "Maharashtra" },
  { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" },
  { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
  { code: "97", name: "Other Territory", special: true },
  { code: "99", name: "Centre Jurisdiction", special: true },
];

const byCode = new Map(GST_STATES.map((s) => [s.code, s]));

export function getState(code: string | null | undefined): GstState | undefined {
  return code ? byCode.get(code) : undefined;
}

export function isValidStateCode(code: string | null | undefined): boolean {
  return !!code && byCode.has(code);
}

export function stateName(code: string | null | undefined): string {
  return getState(code)?.name ?? "";
}

/** "Maharashtra (27)" — the form printed on invoices. */
export function stateLabel(code: string | null | undefined): string {
  const s = getState(code);
  return s ? `${s.name} (${s.code})` : "";
}

/** States offered in address pickers (no legacy or special codes). */
export const SELECTABLE_STATES = GST_STATES.filter((s) => !s.legacy && !s.special);
/** States offered as place of supply (includes 97 Other Territory). */
export const PLACE_OF_SUPPLY_STATES = GST_STATES.filter((s) => !s.legacy && s.code !== "99");
