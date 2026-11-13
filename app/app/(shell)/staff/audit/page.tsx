import { PageHeader } from "@/components/shared/page-header";
import { AuditLog } from "@/components/settings/audit-log";
import { requirePage } from "@/lib/auth/context";
import type { SearchParams } from "@/lib/list";

export const metadata = { title: "Staff audit trail" };

export default async function StaffAuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePage("staff.manage");
  const sp = await searchParams;

  return (
    <>
      <PageHeader
        title="Staff audit trail"
        description="Every change to staff and roles: who joined, role changes, deactivations and permission changes."
        backHref="/app/staff"
      />
      <AuditLog ctx={ctx} sp={sp} scope="staff" basePath="/app/staff/audit" />
    </>
  );
}
