import { notFound, redirect } from "next/navigation";
import { PurchaseEntry } from "@/components/purchases/purchase-flow";
import { PageHeader } from "@/components/shared/page-header";
import { requirePage } from "@/lib/auth/context";
import { formatDateTime, istDateString } from "@/lib/dates";
import { firstIncompleteStep } from "@/lib/purchases/flow";
import { billToPrefill, prefillToFormValues } from "@/lib/purchases/prefill";
import { loadBillFormData, signAttachments } from "@/lib/purchases/server";
import type { VendorOption } from "@/lib/purchases/types";
import type { PurchaseBill, PurchaseBillItem } from "@/lib/types/db";
import { uuid } from "@/lib/validation/common";

export const metadata = { title: "Complete purchase" };

export default async function EditPurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("purchases.create");
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();

  const { data: billRow } = await ctx.supabase
    .from("purchase_bills")
    .select("*, created_by, vendor:vendors(id, name, gstin, state_code, phone)")
    .eq("id", id)
    .eq("business_id", ctx.business.id)
    .maybeSingle();
  const bill = billRow as (PurchaseBill & { created_by: string | null; vendor: VendorOption | null }) | null;
  if (!bill) notFound();
  if (bill.status !== "draft") redirect(`/app/purchases/${id}`);

  const [{ data: itemRows }, data, attachmentUrls, { data: profile }] = await Promise.all([
    ctx.supabase.from("purchase_bill_items").select("*").eq("purchase_bill_id", id).order("line_no"),
    loadBillFormData(ctx),
    signAttachments(ctx, bill.attachment_paths),
    bill.created_by
      ? ctx.supabase.from("profiles").select("full_name, email").eq("id", bill.created_by).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const items = (itemRows ?? []) as PurchaseBillItem[];

  // Keep the saved vendor selectable even if it has been made inactive since.
  const vendors = bill.vendor && !data.vendors.some((v) => v.id === bill.vendor!.id) ? [bill.vendor, ...data.vendors] : data.vendors;
  // If the bill's outlet has been deactivated since, the form moves it to the first outlet the user can use.
  const outlets = data.outlets;
  const fallbackOutlet = outlets.find((o) => o.id === bill.outlet_id) ?? outlets[0];
  if (!fallbackOutlet) redirect(`/app/purchases/${id}`);

  const defaults = prefillToFormValues(billToPrefill({ ...bill, outlet_id: fallbackOutlet.id }, items), {
    outletId: fallbackOutlet.id,
    isInterState: bill.is_inter_state,
  });
  const who = profile as { full_name: string | null; email: string | null } | null;
  const savedBy = who?.full_name || who?.email || "a team member";
  const complete = firstIncompleteStep(defaults) === 4;

  return (
    <>
      <PageHeader
        title={complete ? "Edit draft purchase" : "Complete purchase"}
        description={`Saved by ${savedBy} on ${formatDateTime(bill.created_at)}. Nothing changes in stock until it is added to stock.`}
        backHref={`/app/purchases/${id}`}
        className="mb-4"
      />
      <PurchaseEntry
        businessId={ctx.business.id}
        defaults={defaults}
        outlets={outlets}
        vendors={vendors}
        recentVendorIds={data.recentVendorIds}
        units={data.units}
        gstRates={data.gstRates}
        attachmentUrls={attachmentUrls}
        today={istDateString()}
        canPost={ctx.can("purchases.post")}
        canCreateVendor={ctx.can("vendors.manage")}
        canCreateProduct={ctx.can("products.manage")}
        exitHref={`/app/purchases/${id}`}
      />
    </>
  );
}
