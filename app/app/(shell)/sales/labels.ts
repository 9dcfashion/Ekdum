import type { InvoiceSource, PaymentMode } from "@/lib/types/db";

export const SOURCE_LABELS: Record<InvoiceSource, string> = {
  pos_online: "POS",
  pos_offline: "POS (offline)",
  back_office: "Back office",
};

export const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  bank_transfer: "Bank transfer",
  credit: "Credit (pay later)",
};

/** Modes money can actually arrive or leave by (credit is not one of them). */
export const MONEY_MODES = ["cash", "upi", "card", "bank_transfer"] as const;

export const RANGE_OPTIONS = [
  { value: "", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom dates" },
];
