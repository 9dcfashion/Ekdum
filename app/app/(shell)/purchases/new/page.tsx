import { Store } from "lucide-react";
import { BillForm } from "@/components/purchases/bill-form";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { requirePage } from "@/lib/auth/context";
import { istDateString } from "@/lib/dates";
import { EMPTY_PREFILL, prefillToFormValues, type DraftPrefill } from "@/lib/purchases/prefill";
import { loadBillFormData } from "@/lib/purchases/server";

export const metadata = { title: "New purchase bill" };

export default async function NewPurchasePage() {
  const ctx = await requirePage("purchases.create");
  if (!ctx.outlet) {
    return (
      <>
        <PageHeader title="New purchase bill" backHref="/app/purchases" />
        <EmptyState icon={Store} title="No outlet available" description="You need access to an outlet before you can enter purchase bills." />
      </>
    );
  }
  const data = await loadBillFormData(ctx);

  // Phase 2: an AI reader will build this prefill from an attached bill. Today a new bill starts empty.
  const prefill: DraftPrefill = EMPTY_PREFILL;

  return (
    <>
      <PageHeader
        title="New purchase bill"
        description="Attach the vendor's bill, enter what it says, then save a draft or post it."
        backHref="/app/purchases"
      />
      <BillForm
        businessId={ctx.business.id}
        defaults={prefillToFormValues(prefill, { outletId: ctx.outlet.id, isInterState: false })}
        outlets={data.outlets}
        vendors={data.vendors}
        units={data.units}
        gstRates={data.gstRates}
        attachmentUrls={{}}
        today={istDateString()}
        canPost={ctx.can("purchases.post")}
        canCreateVendor={ctx.can("vendors.manage")}
        canCreateProduct={ctx.can("products.manage")}
      />
    </>
  );
}
