import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { ShipmentForm } from "@/components/shipments/shipment-form";
import { requirePage } from "@/lib/auth/context";
import { istDateString } from "@/lib/dates";
import { param, type SearchParams } from "@/lib/list";
import type { InvoiceMatch } from "@/lib/shipments";

export const metadata = { title: "New shipment" };

export default async function NewShipmentPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePage("shipments.create");
  const sp = await searchParams;
  const invoiceParam = param(sp, "invoice");
  const invoiceId = z.uuid().safeParse(invoiceParam).success ? invoiceParam : null;

  const [couriersResult, invoiceResult] = await Promise.all([
    ctx.supabase
      .from("courier_partners")
      .select("id, name")
      .eq("business_id", ctx.business.id)
      .eq("is_active", true)
      .order("name", { ascending: true }),
    invoiceId
      ? ctx.supabase
          .from("sales_invoices")
          .select(
            "id, invoice_number, invoice_date, customer_name, customer_phone, customer_address, customer_pincode, customer_state_code, total_paise",
          )
          .eq("id", invoiceId)
          .eq("business_id", ctx.business.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const couriers = (couriersResult.data ?? []) as Array<{ id: string; name: string }>;
  // Null when the bill does not exist or RLS hides it from this user: the form then starts as a standalone shipment.
  const invoice = (invoiceResult.data ?? null) as InvoiceMatch | null;
  const canView = ctx.can("shipments.view");

  return (
    <>
      <PageHeader
        title="New shipment"
        description={invoice ? `For bill ${invoice.invoice_number}` : "Log a parcel you are sending by courier."}
        backHref={canView ? "/app/shipments" : undefined}
        className="mx-auto max-w-2xl"
      />
      <ShipmentForm
        businessId={ctx.business.id}
        couriers={couriers}
        canManageCouriers={ctx.can("settings.manage")}
        canPickInvoice={ctx.can(["sales.view_all", "sales.view_own"])}
        canView={canView}
        initialInvoice={invoice}
        invoiceUnavailable={!!invoiceParam && !invoice}
        today={istDateString()}
      />
    </>
  );
}
