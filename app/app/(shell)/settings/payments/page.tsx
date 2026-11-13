import { PaymentsForm } from "@/components/settings/payments-form";
import { SettingsSection } from "@/components/settings/section";
import { requirePage } from "@/lib/auth/context";

export const metadata = { title: "Bank and UPI" };

export default async function PaymentsPage() {
  const ctx = await requirePage("settings.manage");
  const b = ctx.business;

  return (
    <SettingsSection title="Bank and UPI" description="How customers pay you. These details are printed on your bills.">
      <PaymentsForm
        payeeName={b.trade_name || b.legal_name}
        initial={{
          bank_name: b.bank_name,
          bank_account_name: b.bank_account_name,
          bank_account_number: b.bank_account_number,
          ifsc: b.ifsc,
          upi_id: b.upi_id,
        }}
      />
    </SettingsSection>
  );
}
