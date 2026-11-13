import Link from "next/link";
import { ChevronRight, Lock } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { requirePage } from "@/lib/auth/context";
import { REPORTS } from "@/lib/reports/definitions";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const ctx = await requirePage("reports.view");
  const canExport = ctx.can("reports.export");

  return (
    <>
      <PageHeader
        title="Reports"
        description={
          canExport
            ? "Pick a report, choose the outlet and dates, and download it as CSV if you need it in a spreadsheet."
            : "Pick a report and choose the outlet and dates."
        }
      />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((report) => {
          const allowed = !report.requires || ctx.can(report.requires);
          return (
            <li key={report.key}>
              {allowed ? (
                <Link
                  href={`/app/reports/${report.key}`}
                  className="flex h-full items-start justify-between gap-3 rounded-xl border bg-card p-4 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span>
                    <span className="block font-medium">{report.title}</span>
                    <span className="mt-0.5 block text-sm text-muted-foreground">{report.description}</span>
                  </span>
                  <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              ) : (
                <div className="flex h-full items-start justify-between gap-3 rounded-xl border border-dashed p-4 text-muted-foreground">
                  <span>
                    <span className="block font-medium">{report.title}</span>
                    <span className="mt-0.5 block text-sm">No access. Your role cannot see this report.</span>
                  </span>
                  <Lock className="mt-1 size-4 shrink-0" aria-hidden />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-xs text-muted-foreground">
        All dates are Indian Standard Time. The GST reports are working reports to help prepare your return. They are not a GSTR-1 filing.
      </p>
    </>
  );
}
