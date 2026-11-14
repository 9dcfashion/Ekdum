import Link from "next/link";
import { ScanBarcode, ShoppingBag } from "lucide-react";

/** The two jobs staff do all day, as big buttons at the top of the home screen. */
export function QuickActions({ canBill, canPurchase }: { canBill: boolean; canPurchase: boolean }) {
  if (!canBill && !canPurchase) return null;
  return (
    <div className="mb-5 grid grid-cols-2 gap-3 sm:max-w-md">
      {canBill ? (
        <Link
          href="/app/pos"
          className="flex min-h-20 flex-col justify-center gap-1 rounded-xl bg-primary px-4 py-3 text-primary-foreground shadow-sm outline-none hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ScanBarcode className="size-6" aria-hidden />
          <span className="text-base font-semibold">New bill</span>
        </Link>
      ) : null}
      {canPurchase ? (
        <Link
          href="/app/purchases/new"
          className="flex min-h-20 flex-col justify-center gap-1 rounded-xl border bg-background px-4 py-3 shadow-xs outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ShoppingBag className="size-6 text-primary" aria-hidden />
          <span className="text-base font-semibold">Enter purchase</span>
        </Link>
      ) : null}
    </div>
  );
}
