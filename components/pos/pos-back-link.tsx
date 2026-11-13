"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { countQueue } from "@/lib/offline/queue";
import { useQueueRows } from "./use-offline";

/**
 * "Back to app" in the POS top bar. With bills still waiting on this device it
 * asks first, because signing out or clearing the browser from there is how an
 * unsynced bill gets lost.
 */
export function PosBackLink({ businessId }: { businessId: string }) {
  const router = useRouter();
  const rows = useQueueRows(businessId);
  const [open, setOpen] = useState(false);
  const counts = countQueue(rows);
  const unsynced = counts.pending + counts.attention;

  return (
    <>
      <Link
        href="/app"
        onClick={(e) => {
          if (unsynced === 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
          e.preventDefault();
          setOpen(true);
        }}
        className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ArrowLeft className="size-4" aria-hidden />
        <span className="hidden sm:inline">Back to app</span>
        <span className="sr-only sm:hidden">Back to app</span>
      </Link>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {unsynced} {unsynced === 1 ? "bill has" : "bills have"} not reached the server yet
            </AlertDialogTitle>
            <AlertDialogDescription>
              They are saved on this device and will sync from this billing screen. Until then, do not sign out, clear this browser&apos;s data or use a private
              window: that would lose them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay on billing</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false);
                router.push("/app");
              }}
            >
              Leave anyway
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
