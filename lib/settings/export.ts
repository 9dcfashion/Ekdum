import "server-only";
import { describeDbError } from "@/lib/actions";
import type { AppContext } from "@/lib/auth/context";
import { formatDate, formatDateTime, istDateString } from "@/lib/dates";
import { stateName } from "@/lib/gst/states";
import { toCsv } from "@/lib/list";
import { paiseToRupees } from "@/lib/money";
import { EXPORT_ENTITIES } from "./export-entities";

type Row = Record<string, unknown>;
type Cell = string | number | boolean | null | undefined;
type Column = [header: string, value: (row: Row) => Cell];

const CHUNK = 1000;
/** Safety stop: 500,000 rows per file. */
const MAX_CHUNKS = 500;

/**
 * Reads a whole table for the active business in chunks of 1,000 rows, with the
 * user's own session, so RLS decides what they may export.
 * Columns are always listed explicitly: token and key-hash columns are never selected.
 */
async function fetchAll(ctx: AppContext, table: string, select: string, orderBy: string[]): Promise<Row[]> {
  const rows: Row[] = [];
  for (let chunk = 0; chunk < MAX_CHUNKS; chunk++) {
    let query = ctx.supabase.from(table).select(select).eq("business_id", ctx.business.id);
    for (const column of orderBy) query = query.order(column, { ascending: true });
    const { data, error } = await query.range(chunk * CHUNK, chunk * CHUNK + CHUNK - 1);
    if (error) throw new Error(describeDbError(error));
    const page = (data ?? []) as unknown as Row[];
    rows.push(...page);
    if (page.length < CHUNK) break;
  }
  return rows;
}

const text = (v: unknown): Cell => (v === null || v === undefined ? "" : (v as Cell));
const money = (v: unknown): Cell => (typeof v === "number" ? paiseToRupees(v) : "");
const date = (v: unknown): Cell => (typeof v === "string" && v ? formatDate(v.length > 10 ? new Date(v) : v) : "");
const dateTime = (v: unknown): Cell => (typeof v === "string" && v ? formatDateTime(v) : "");
const yesNo = (v: unknown): Cell => (v === true ? "Yes" : v === false ? "No" : "");
const state = (v: unknown): Cell => (typeof v === "string" && v ? stateName(v) : "");

/** A field of an embedded (to-one) relation, e.g. rel(row, "invoice", "invoice_number"). */
function rel(row: Row, alias: string, field: string): unknown {
  const value = row[alias];
  const object = Array.isArray(value) ? value[0] : value;
  return object && typeof object === "object" ? (object as Row)[field] : null;
}

const col = (header: string, key: string, format: (v: unknown) => Cell = text): Column => [header, (r) => format(r[key])];

const TAX_COLUMNS: Column[] = [
  col("Taxable value (Rs)", "taxable_paise", money),
  col("CGST (Rs)", "cgst_paise", money),
  col("SGST (Rs)", "sgst_paise", money),
  col("IGST (Rs)", "igst_paise", money),
  col("Cess (Rs)", "cess_paise", money),
];

const ADDRESS_COLUMNS: Column[] = [
  col("Address line 1", "address_line1"),
  col("Address line 2", "address_line2"),
  col("City", "city"),
  col("PIN code", "pincode"),
  col("State", "state_code", state),
];

async function outletNames(ctx: AppContext): Promise<Map<string, string>> {
  const { data } = await ctx.supabase.from("outlets").select("id, name").eq("business_id", ctx.business.id);
  return new Map(((data ?? []) as Array<{ id: string; name: string }>).map((o) => [o.id, o.name]));
}

async function build(ctx: AppContext, key: string): Promise<{ columns: Column[]; rows: Row[] } | null> {
  switch (key) {
    case "products": {
      const rows = await fetchAll(
        ctx,
        "products",
        "id, name, sku, barcode, hsn_code, unit_code, gst_rate, cess_rate, sale_price_paise, price_includes_tax, mrp_paise, track_inventory, low_stock_threshold, is_active, created_at, category:product_categories(name)",
        ["created_at", "id"],
      );
      const columns: Column[] = [
        col("Name", "name"),
        col("SKU", "sku"),
        col("Barcode", "barcode"),
        ["Category", (r) => text(rel(r, "category", "name"))],
        col("HSN/SAC", "hsn_code"),
        col("Unit", "unit_code"),
        col("GST %", "gst_rate"),
        col("Cess %", "cess_rate"),
        col("Selling price (Rs)", "sale_price_paise", money),
        col("Price includes tax", "price_includes_tax", yesNo),
        col("MRP (Rs)", "mrp_paise", money),
      ];
      // Cost prices live in their own table and only for roles that may see them.
      if (ctx.can("products.view_cost")) {
        const costs = await fetchAll(ctx, "product_costs", "product_id, purchase_price_paise", ["product_id"]);
        const byProduct = new Map(costs.map((c) => [c.product_id as string, c.purchase_price_paise]));
        columns.push(["Purchase price (Rs)", (r) => money(byProduct.get(r.id as string))]);
      }
      columns.push(
        col("Tracks stock", "track_inventory", yesNo),
        col("Low stock alert at", "low_stock_threshold"),
        col("Active", "is_active", yesNo),
        col("Created", "created_at", dateTime),
      );
      return { columns, rows };
    }

    case "customers":
      return {
        rows: await fetchAll(
          ctx,
          "customers",
          "id, name, phone, email, gstin, address_line1, address_line2, city, pincode, state_code, whatsapp_opt_in, notes, created_at",
          ["created_at", "id"],
        ),
        columns: [
          col("Name", "name"),
          col("Phone", "phone"),
          col("Email", "email"),
          col("GSTIN", "gstin"),
          ...ADDRESS_COLUMNS,
          col("WhatsApp opt-in", "whatsapp_opt_in", yesNo),
          col("Notes", "notes"),
          col("Created", "created_at", dateTime),
        ],
      };

    case "vendors":
      return {
        rows: await fetchAll(
          ctx,
          "vendors",
          "id, name, gstin, phone, email, address_line1, address_line2, city, pincode, state_code, notes, is_active, created_at",
          ["created_at", "id"],
        ),
        columns: [
          col("Name", "name"),
          col("GSTIN", "gstin"),
          col("Phone", "phone"),
          col("Email", "email"),
          ...ADDRESS_COLUMNS,
          col("Notes", "notes"),
          col("Active", "is_active", yesNo),
          col("Created", "created_at", dateTime),
        ],
      };

    case "sales-invoices": {
      const outlets = await outletNames(ctx);
      return {
        rows: await fetchAll(
          ctx,
          "sales_invoices",
          "id, outlet_id, invoice_number, financial_year, document_type, invoice_date, seller_gstin, customer_name, customer_phone, customer_gstin, customer_state_code, supply_type, place_of_supply_state, is_inter_state, subtotal_paise, discount_paise, taxable_paise, cgst_paise, sgst_paise, igst_paise, cess_paise, round_off_paise, total_paise, amount_due_paise, status, cancelled_at, cancel_reason, source, notes, created_at",
          ["created_at", "id"],
        ),
        columns: [
          col("Bill number", "invoice_number"),
          col("Date", "invoice_date", date),
          col("Financial year", "financial_year"),
          col("Document", "document_type"),
          ["Outlet", (r) => outlets.get(r.outlet_id as string) ?? ""],
          col("Status", "status"),
          col("Seller GSTIN", "seller_gstin"),
          col("Customer", "customer_name"),
          col("Customer phone", "customer_phone"),
          col("Customer GSTIN", "customer_gstin"),
          col("Supply type", "supply_type"),
          col("Place of supply", "place_of_supply_state", state),
          col("Inter-state", "is_inter_state", yesNo),
          col("Subtotal (Rs)", "subtotal_paise", money),
          col("Discount (Rs)", "discount_paise", money),
          ...TAX_COLUMNS,
          col("Round off (Rs)", "round_off_paise", money),
          col("Total (Rs)", "total_paise", money),
          col("Amount due (Rs)", "amount_due_paise", money),
          col("Made from", "source"),
          col("Cancelled at", "cancelled_at", dateTime),
          col("Cancel reason", "cancel_reason"),
          col("Notes", "notes"),
          col("Created", "created_at", dateTime),
        ],
      };
    }

    case "sales-invoice-items":
      return {
        rows: await fetchAll(
          ctx,
          "sales_invoice_items",
          "id, invoice_id, line_no, description, hsn_code, quantity, unit_code, unit_price_paise, price_includes_tax, discount_paise, taxable_paise, gst_rate, cess_rate, cgst_paise, sgst_paise, igst_paise, cess_paise, total_paise, invoice:sales_invoices(invoice_number, invoice_date, status)",
          ["invoice_id", "line_no"],
        ),
        columns: [
          ["Bill number", (r) => text(rel(r, "invoice", "invoice_number"))],
          ["Bill date", (r) => date(rel(r, "invoice", "invoice_date"))],
          ["Bill status", (r) => text(rel(r, "invoice", "status"))],
          col("Line", "line_no"),
          col("Item", "description"),
          col("HSN/SAC", "hsn_code"),
          col("Quantity", "quantity"),
          col("Unit", "unit_code"),
          col("Unit price (Rs)", "unit_price_paise", money),
          col("Price includes tax", "price_includes_tax", yesNo),
          col("Discount (Rs)", "discount_paise", money),
          col("GST %", "gst_rate"),
          col("Cess %", "cess_rate"),
          ...TAX_COLUMNS,
          col("Line total (Rs)", "total_paise", money),
        ],
      };

    case "sales-payments":
      return {
        rows: await fetchAll(
          ctx,
          "sales_payments",
          "id, invoice_id, mode, amount_paise, reference, is_collection, received_on, created_at, invoice:sales_invoices(invoice_number)",
          ["created_at", "id"],
        ),
        columns: [
          ["Bill number", (r) => text(rel(r, "invoice", "invoice_number"))],
          col("Received on", "received_on", date),
          col("Mode", "mode"),
          col("Amount (Rs)", "amount_paise", money),
          col("Reference", "reference"),
          col("Collected later", "is_collection", yesNo),
          col("Recorded", "created_at", dateTime),
        ],
      };

    case "credit-notes": {
      const outlets = await outletNames(ctx);
      return {
        rows: await fetchAll(
          ctx,
          "credit_notes",
          "id, outlet_id, credit_note_number, financial_year, credit_note_date, seller_gstin, reason, restock, is_inter_state, taxable_paise, cgst_paise, sgst_paise, igst_paise, cess_paise, round_off_paise, total_paise, adjusted_against_due_paise, refund_paise, refund_mode, created_at, invoice:sales_invoices(invoice_number)",
          ["created_at", "id"],
        ),
        columns: [
          col("Credit note number", "credit_note_number"),
          col("Date", "credit_note_date", date),
          col("Financial year", "financial_year"),
          ["Against bill", (r) => text(rel(r, "invoice", "invoice_number"))],
          ["Outlet", (r) => outlets.get(r.outlet_id as string) ?? ""],
          col("Seller GSTIN", "seller_gstin"),
          col("Reason", "reason"),
          col("Stock returned", "restock", yesNo),
          col("Inter-state", "is_inter_state", yesNo),
          ...TAX_COLUMNS,
          col("Round off (Rs)", "round_off_paise", money),
          col("Total (Rs)", "total_paise", money),
          col("Adjusted against dues (Rs)", "adjusted_against_due_paise", money),
          col("Refunded (Rs)", "refund_paise", money),
          col("Refund mode", "refund_mode"),
          col("Created", "created_at", dateTime),
        ],
      };
    }

    case "purchase-bills": {
      const outlets = await outletNames(ctx);
      return {
        rows: await fetchAll(
          ctx,
          "purchase_bills",
          "id, outlet_id, vendor_invoice_number, vendor_invoice_date, financial_year, place_of_supply_state, is_inter_state, status, subtotal_paise, discount_paise, taxable_paise, cgst_paise, sgst_paise, igst_paise, cess_paise, round_off_paise, total_paise, amount_paid_paise, payment_status, notes, posted_at, cancelled_at, cancel_reason, created_at, vendor:vendors(name, gstin)",
          ["created_at", "id"],
        ),
        columns: [
          ["Vendor", (r) => text(rel(r, "vendor", "name"))],
          ["Vendor GSTIN", (r) => text(rel(r, "vendor", "gstin"))],
          col("Vendor invoice number", "vendor_invoice_number"),
          col("Vendor invoice date", "vendor_invoice_date", date),
          col("Financial year", "financial_year"),
          ["Outlet", (r) => outlets.get(r.outlet_id as string) ?? ""],
          col("Status", "status"),
          col("Payment status", "payment_status"),
          col("Place of supply", "place_of_supply_state", state),
          col("Inter-state", "is_inter_state", yesNo),
          col("Subtotal (Rs)", "subtotal_paise", money),
          col("Discount (Rs)", "discount_paise", money),
          ...TAX_COLUMNS,
          col("Round off (Rs)", "round_off_paise", money),
          col("Total (Rs)", "total_paise", money),
          col("Paid (Rs)", "amount_paid_paise", money),
          col("Posted at", "posted_at", dateTime),
          col("Cancelled at", "cancelled_at", dateTime),
          col("Cancel reason", "cancel_reason"),
          col("Notes", "notes"),
          col("Created", "created_at", dateTime),
        ],
      };
    }

    case "purchase-bill-items":
      return {
        rows: await fetchAll(
          ctx,
          "purchase_bill_items",
          "id, purchase_bill_id, line_no, description, hsn_code, quantity, unit_code, rate_paise, price_includes_tax, discount_paise, taxable_paise, gst_rate, cess_rate, cgst_paise, sgst_paise, igst_paise, cess_paise, total_paise, bill:purchase_bills(vendor_invoice_number, vendor_invoice_date, status)",
          ["purchase_bill_id", "line_no"],
        ),
        columns: [
          ["Vendor invoice number", (r) => text(rel(r, "bill", "vendor_invoice_number"))],
          ["Vendor invoice date", (r) => date(rel(r, "bill", "vendor_invoice_date"))],
          ["Bill status", (r) => text(rel(r, "bill", "status"))],
          col("Line", "line_no"),
          col("Item", "description"),
          col("HSN/SAC", "hsn_code"),
          col("Quantity", "quantity"),
          col("Unit", "unit_code"),
          col("Rate (Rs)", "rate_paise", money),
          col("Rate includes tax", "price_includes_tax", yesNo),
          col("Discount (Rs)", "discount_paise", money),
          col("GST %", "gst_rate"),
          col("Cess %", "cess_rate"),
          ...TAX_COLUMNS,
          col("Line total (Rs)", "total_paise", money),
        ],
      };

    case "stock-levels": {
      const outlets = await outletNames(ctx);
      return {
        rows: await fetchAll(ctx, "stock_levels", "product_id, outlet_id, quantity, updated_at, product:products(name, sku, unit_code)", [
          "product_id",
          "outlet_id",
        ]),
        columns: [
          ["Product", (r) => text(rel(r, "product", "name"))],
          ["SKU", (r) => text(rel(r, "product", "sku"))],
          ["Outlet", (r) => outlets.get(r.outlet_id as string) ?? ""],
          col("Quantity", "quantity"),
          ["Unit", (r) => text(rel(r, "product", "unit_code"))],
          col("Updated", "updated_at", dateTime),
        ],
      };
    }

    case "stock-movements": {
      const outlets = await outletNames(ctx);
      return {
        rows: await fetchAll(
          ctx,
          "stock_movements",
          "id, outlet_id, product_id, quantity_delta, movement_type, reason, note, created_at, product:products(name, sku)",
          ["created_at", "id"],
        ),
        columns: [
          col("Date", "created_at", dateTime),
          ["Product", (r) => text(rel(r, "product", "name"))],
          ["SKU", (r) => text(rel(r, "product", "sku"))],
          ["Outlet", (r) => outlets.get(r.outlet_id as string) ?? ""],
          col("Change", "quantity_delta"),
          col("Type", "movement_type"),
          col("Reason", "reason"),
          col("Note", "note"),
        ],
      };
    }

    case "shipments": {
      const outlets = await outletNames(ctx);
      return {
        rows: await fetchAll(
          ctx,
          "shipments",
          "id, outlet_id, recipient_name, recipient_phone, address_line1, address_line2, city, pincode, state_code, tracking_number, shipped_on, package_count, weight_grams, declared_value_paise, status, status_changed_at, notes, created_at, courier:courier_partners(name), invoice:sales_invoices(invoice_number)",
          ["created_at", "id"],
        ),
        columns: [
          col("Shipped on", "shipped_on", date),
          ["Outlet", (r) => outlets.get(r.outlet_id as string) ?? ""],
          ["Bill number", (r) => text(rel(r, "invoice", "invoice_number"))],
          col("Recipient", "recipient_name"),
          col("Phone", "recipient_phone"),
          ...ADDRESS_COLUMNS,
          ["Courier", (r) => text(rel(r, "courier", "name"))],
          col("Tracking number", "tracking_number"),
          col("Packages", "package_count"),
          col("Weight (g)", "weight_grams"),
          col("Declared value (Rs)", "declared_value_paise", money),
          col("Status", "status"),
          col("Status changed", "status_changed_at", dateTime),
          col("Notes", "notes"),
          col("Created", "created_at", dateTime),
        ],
      };
    }

    case "staff": {
      const outlets = await outletNames(ctx);
      const rows = await fetchAll(
        ctx,
        "business_members",
        "id, user_id, is_active, all_outlets, last_active_at, created_at, role:roles(name), member_outlets(outlet_id)",
        ["created_at", "id"],
      );
      const profiles = new Map<string, { full_name: string; email: string | null; phone: string | null }>();
      const userIds = rows.map((r) => r.user_id as string);
      for (let i = 0; i < userIds.length; i += 200) {
        const { data } = await ctx.supabase.from("profiles").select("id, full_name, email, phone").in("id", userIds.slice(i, i + 200));
        for (const p of (data ?? []) as Array<{ id: string; full_name: string; email: string | null; phone: string | null }>) {
          profiles.set(p.id, p);
        }
      }
      return {
        rows,
        columns: [
          ["Name", (r) => profiles.get(r.user_id as string)?.full_name ?? ""],
          ["Email", (r) => profiles.get(r.user_id as string)?.email ?? ""],
          ["Phone", (r) => profiles.get(r.user_id as string)?.phone ?? ""],
          ["Role", (r) => text(rel(r, "role", "name"))],
          ["Status", (r) => (r.is_active ? "Active" : "Inactive")],
          [
            "Outlet access",
            (r) =>
              r.all_outlets
                ? "All outlets"
                : ((r.member_outlets ?? []) as Array<{ outlet_id: string }>)
                    .map((m) => outlets.get(m.outlet_id) ?? "Another outlet")
                    .join("; "),
          ],
          col("Last active", "last_active_at", dateTime),
          col("Joined", "created_at", dateTime),
        ],
      };
    }

    default:
      return null;
  }
}

/** CSV for one entity, or null when the entity is not one we export. */
export async function buildExportCsv(ctx: AppContext, key: string): Promise<{ filename: string; csv: string; rowCount: number } | null> {
  if (!EXPORT_ENTITIES.some((e) => e.key === key)) return null;
  const built = await build(ctx, key);
  if (!built) return null;
  const csv = toCsv(
    built.columns.map(([header]) => header),
    built.rows.map((row) => built.columns.map(([, value]) => value(row))),
  );
  return { filename: `ekdum-${key}-${istDateString()}.csv`, csv, rowCount: built.rows.length };
}
