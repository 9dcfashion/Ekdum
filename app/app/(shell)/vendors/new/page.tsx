import { VendorForm } from "@/components/parties/vendor-form";
import { PageHeader } from "@/components/shared/page-header";
import { requirePage } from "@/lib/auth/context";
import { saveVendorAction } from "../actions";

export const metadata = { title: "New vendor" };

export default async function NewVendorPage() {
  await requirePage("vendors.manage");
  return (
    <>
      <PageHeader title="New vendor" description="Suppliers you buy stock from." backHref="/app/vendors" />
      <VendorForm saveAction={saveVendorAction} />
    </>
  );
}
