import { notFound, redirect } from "next/navigation";
import { BillForm } from "@/components/purchases/bill-form";
import { PageHeader } from "@/components/shared/page-header";
import { requirePage } from "@/lib/auth/context";
import { istDateString } from "@/lib/dates";
import { billToPrefill, prefillToFormValues } from "@/lib/purchases/prefill";
import { loadBillFormData, signAttachments } from "@/lib/purchases/server";
import type { VendorOption } from "@/lib/purchases/types";
import type { PurchaseBill, PurchaseBillItem } from "@/lib/types/db";
import { uuid } from "@/lib/validation/common";

export const metadata = { title: "Edit purchase bill" };

export default async function EditPurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("purchases.create");
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();

  const { data: billRow } = await ctx.supabase
    .from("purchase_bills")
    .select("*, vendor:vendors(id, name, gstin, state_code)")
    .eq("id", id)
    .eq("business_id", ctx.business.id)
    .maybeSingle();
  const bill = billRow as (PurchaseBill & { vendor: VendorOption | null }) | null;
  if (!bill) notFound();
  if (bill.status !== "draft") redirect(`/app/purchases/${id}`);

  const [{ data: itemRows }, data, attachmentUrls] = await Promise.all([
    ctx.supabase.from("purchase_bill_items").select("*").eq("purchase_bill_id", id).order("line_no"),
    loadBillFormData(ctx),
    signAttachments(ctx, bill.attachment_paths),
  ]);
  const items = (itemRows ?? []) as PurchaseBillItem[];

  // Keep the saved vendor selectable even if it has been made inactive since.
  const vendors = bill.vendor && !data.vendors.some((v) => v.id === bill.vendor!.id) ? [bill.vendor, ...data.vendors] : data.vendors;
  // If the bill's outlet has been deactivated since, the form moves it to the first outlet the user can use.
  const outlets = data.outlets;
  const fallbackOutlet = outlets.find((o) => o.id === bill.outlet_id) ?? outlets[0];
  if (!fallbackOutlet) redirect(`/app/purchases/${id}`);

  return (
    <>
      <PageHeader
        title="Edit draft purchase bill"
        description="Nothing touches stock until you post it."
        backHref={`/app/purchases/${id}`}
      />
      <BillForm
        businessId={ctx.business.id}
        defaults={prefillToFormValues(billToPrefill({ ...bill, outlet_id: fallbackOutlet.id }, items), {
          outletId: fallbackOutlet.id,
          isInterState: bill.is_inter_state,
        })}
        outlets={outlets}
        vendors={vendors}
        units={data.units}
        gstRates={data.gstRates}
        attachmentUrls={attachmentUrls}
        today={istDateString()}
        canPost={ctx.can("purchases.post")}
        canCreateVendor={ctx.can("vendors.manage")}
        canCreateProduct={ctx.can("products.manage")}
      />
    </>
  );
}
