import { ShieldAlert } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";

export const metadata = { title: "No access" };

export default function NoAccessPage() {
  return (
    <EmptyState
      icon={ShieldAlert}
      title="You don't have access to this page"
      description="Your role does not include this section. Ask the owner of the business if you need it."
      className="mt-10"
    />
  );
}
