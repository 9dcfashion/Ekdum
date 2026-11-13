import { AuditLog } from "@/components/settings/audit-log";
import { SettingsSection } from "@/components/settings/section";
import { requirePage } from "@/lib/auth/context";
import type { SearchParams } from "@/lib/list";

export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePage("settings.manage");
  const sp = await searchParams;

  return (
    <SettingsSection
      title="Audit log"
      description="A permanent record of sensitive actions: who did it, when, and what changed. It cannot be edited or deleted."
    >
      <AuditLog ctx={ctx} sp={sp} scope="all" basePath="/app/settings/audit" />
    </SettingsSection>
  );
}
