import { Store } from "lucide-react";
import { PurchaseEntry } from "@/components/purchases/purchase-flow";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { requirePage } from "@/lib/auth/context";
import { istDateString } from "@/lib/dates";
import { EMPTY_PREFILL, prefillToFormValues, type DraftPrefill } from "@/lib/purchases/prefill";
import { loadBillFormData } from "@/lib/purchases/server";

export const metadata = { title: "New purchase" };

export default async function NewPurchasePage() {
  const ctx = await requirePage("purchases.create");
  if (!ctx.outlet) {
    return (
      <>
        <PageHeader title="New purchase" backHref="/app/purchases" />
        <EmptyState icon={Store} title="No outlet available" description="You need access to an outlet before you can enter purchase bills." />
      </>
    );
  }
  const data = await loadBillFormData(ctx);

  // Phase 2: an AI reader will build this prefill from the bill photo. Today a new bill starts empty.
  const prefill: DraftPrefill = EMPTY_PREFILL;

  return (
    <>
      <PageHeader title="New purchase" backHref="/app/purchases" className="mb-4" />
      <PurchaseEntry
        businessId={ctx.business.id}
        defaults={prefillToFormValues(prefill, { outletId: ctx.outlet.id, isInterState: false })}
        outlets={data.outlets}
        vendors={data.vendors}
        recentVendorIds={data.recentVendorIds}
        units={data.units}
        gstRates={data.gstRates}
        attachmentUrls={{}}
        today={istDateString()}
        canPost={ctx.can("purchases.post")}
        canCreateVendor={ctx.can("vendors.manage")}
        canCreateProduct={ctx.can("products.manage")}
        exitHref="/app/purchases"
      />
    </>
  );
}
