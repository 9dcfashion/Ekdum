import Link from "next/link";
import { PackageX } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";

export default function ShipmentNotFound() {
  return (
    <EmptyState
      icon={PackageX}
      title="Shipment not found"
      description="It may belong to another outlet, or the link may be wrong."
      className="mt-10"
      action={
        <Button asChild>
          <Link href="/app/shipments">Back to shipments</Link>
        </Button>
      }
    />
  );
}
