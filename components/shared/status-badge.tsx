import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const TONES = {
  green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  red: "border-red-200 bg-red-50 text-red-700",
  blue: "border-sky-200 bg-sky-50 text-sky-700",
  indigo: "border-indigo-200 bg-indigo-50 text-indigo-700",
  gray: "border-zinc-200 bg-zinc-50 text-zinc-600",
} as const;

export type Tone = keyof typeof TONES;

const STATUS: Record<string, { label: string; tone: Tone }> = {
  // documents
  posted: { label: "Posted", tone: "green" },
  draft: { label: "Draft", tone: "amber" },
  cancelled: { label: "Cancelled", tone: "red" },
  // payments
  paid: { label: "Paid", tone: "green" },
  partial: { label: "Part paid", tone: "amber" },
  unpaid: { label: "Unpaid", tone: "red" },
  // shipments
  booked: { label: "Booked", tone: "blue" },
  picked_up: { label: "Picked up", tone: "indigo" },
  in_transit: { label: "In transit", tone: "amber" },
  delivered: { label: "Delivered", tone: "green" },
  rto: { label: "RTO", tone: "red" },
  // notifications
  queued: { label: "Queued", tone: "gray" },
  sending: { label: "Sending", tone: "blue" },
  sent: { label: "Sent", tone: "green" },
  failed: { label: "Failed", tone: "red" },
  // generic
  active: { label: "Active", tone: "green" },
  inactive: { label: "Inactive", tone: "gray" },
  pending: { label: "Pending", tone: "amber" },
  expired: { label: "Expired", tone: "gray" },
};

export function StatusBadge({ status, label, tone, className }: { status?: string; label?: string; tone?: Tone; className?: string }) {
  const known = status ? STATUS[status] : undefined;
  return (
    <Badge variant="outline" className={cn("font-medium", TONES[tone ?? known?.tone ?? "gray"], className)}>
      {label ?? known?.label ?? status}
    </Badge>
  );
}
