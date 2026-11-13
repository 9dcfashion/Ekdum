import { Download } from "lucide-react";
import { InfoBox, SettingsSection } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { requirePage } from "@/lib/auth/context";
import { EXPORT_ENTITIES } from "@/lib/settings/export-entities";

export const metadata = { title: "Data export" };

export default async function DataExportPage() {
  await requirePage("settings.manage");

  return (
    <SettingsSection
      title="Data export"
      description="Your data is yours. Download any part of it as a CSV file that opens in Excel or Google Sheets."
    >
      <ul className="grid gap-2 md:grid-cols-2">
        {EXPORT_ENTITIES.map((entity) => (
          <li key={entity.key} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm">
            <div className="min-w-0">
              <p className="font-medium">{entity.label}</p>
              <p className="text-xs text-muted-foreground">{entity.description}</p>
            </div>
            <Button variant="outline" size="sm" asChild>
              {/* A plain link: the route answers with a file download, so there is nothing to prefetch or render. */}
              <a href={`/app/settings/data/${entity.key}`} download aria-label={`Download ${entity.label} as CSV`}>
                <Download aria-hidden /> CSV
              </a>
            </Button>
          </li>
        ))}
      </ul>
      <InfoBox className="mt-5">
        <ul>
          <li>Each file has everything your role is allowed to see, across the outlets you have access to.</li>
          <li>Amounts are in rupees. Dates are in Indian time, as DD/MM/YYYY.</li>
          <li>Large files can take a little while to prepare. Wait for the download to start before clicking again.</li>
          <li>These files can contain customer phone numbers and addresses. Keep them somewhere safe.</li>
        </ul>
      </InfoBox>
    </SettingsSection>
  );
}
