export interface ExportEntity {
  /** URL segment: /app/settings/data/{key} */
  key: string;
  label: string;
  description: string;
}

export const EXPORT_ENTITIES: ExportEntity[] = [
  { key: "products", label: "Products", description: "Your catalogue with prices, HSN and GST rates. Includes purchase prices when your role can see them." },
  { key: "customers", label: "Customers", description: "Names, phone numbers, GSTINs and addresses." },
  { key: "vendors", label: "Vendors", description: "Suppliers with GSTINs and contact details." },
  { key: "sales-invoices", label: "Sales bills", description: "One row per bill with tax totals and status. Cancelled bills are included." },
  { key: "sales-invoice-items", label: "Sales bill items", description: "One row per line on every bill." },
  { key: "sales-payments", label: "Sales payments", description: "Every payment received, by mode." },
  { key: "credit-notes", label: "Credit notes", description: "Returns and their refunds." },
  { key: "purchase-bills", label: "Purchase bills", description: "One row per vendor bill, including drafts." },
  { key: "purchase-bill-items", label: "Purchase bill items", description: "One row per line on every purchase bill." },
  { key: "stock-levels", label: "Stock levels", description: "Current quantity of each product at each outlet." },
  { key: "stock-movements", label: "Stock movements", description: "Every change to stock: sales, purchases, returns and adjustments." },
  { key: "shipments", label: "Shipments", description: "The courier log with tracking numbers and status." },
  { key: "staff", label: "Staff members", description: "People, roles, outlet access and last active time." },
];
