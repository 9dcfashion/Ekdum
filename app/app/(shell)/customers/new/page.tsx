import { CustomerForm } from "@/components/parties/customer-form";
import { PageHeader } from "@/components/shared/page-header";
import { requirePage } from "@/lib/auth/context";
import { saveCustomerAction } from "../actions";

export const metadata = { title: "New customer" };

export default async function NewCustomerPage() {
  await requirePage("customers.manage");
  return (
    <>
      <PageHeader
        title="New customer"
        description="Save a customer once and pick them at the counter by phone number."
        backHref="/app/customers"
      />
      <CustomerForm saveAction={saveCustomerAction} />
    </>
  );
}
