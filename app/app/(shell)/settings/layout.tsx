import { PageHeader } from "@/components/shared/page-header";
import { SettingsNav } from "@/components/settings/settings-nav";

export const metadata = { title: "Settings" };

/** Shared frame for every settings page. Each page still checks `settings.manage` itself. */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title="Settings" description="How your business appears on bills and how EkDum works for you." className="mb-4" />
      <SettingsNav />
      {children}
    </>
  );
}
