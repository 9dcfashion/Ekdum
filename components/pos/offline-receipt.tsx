"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { CloudOff, Printer } from "lucide-react";
import { ThermalReceipt, thermalCss } from "@/components/invoice/thermal-receipt";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { qrDataUrl } from "@/lib/invoices/qr";
import { getOfflineRepo } from "@/lib/offline/db";
import type { QueueRow } from "@/lib/offline/types";

const PRINT_ROOT = "ekdum-print-root";

/** On paper only the slip exists; on screen the print copy is hidden (the dialog shows its own preview). */
const PRINT_ONLY_CSS = `
@media screen { .${PRINT_ROOT} { display: none !important; } }
@media print {
  body > *:not(.${PRINT_ROOT}) { display: none !important; }
  .${PRINT_ROOT} { display: block !important; }
}
`;

const noSubscribe = () => () => undefined;

/**
 * The thermal slip of a bill kept on this device, rendered and printed entirely
 * in the browser: same component and view model as the server's print page, no
 * network involved. Works for a bill that has not reached the server yet.
 */
export function OfflineReceiptDialog({ row, autoPrint = false, onClose }: { row: QueueRow | null; autoPrint?: boolean; onClose: () => void }) {
  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92dvh] gap-3 overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bill {row?.number}</DialogTitle>
          <DialogDescription>
            {row?.status === "synced" ? "Printed from the copy saved on this device." : "Saved on this device. Printed without the internet."}
          </DialogDescription>
        </DialogHeader>
        {row ? <ReceiptBody key={`${row.clientUuid}:${row.number}`} row={row} autoPrint={autoPrint} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ReceiptBody({ row, autoPrint, onClose }: { row: QueueRow; autoPrint: boolean; onClose: () => void }) {
  const view = row.receipt;
  const paper = row.printFormat === "thermal_58" ? 58 : 80;
  // Like the server's print page: the pay-by-UPI code is printed when money is still owed, or on request.
  const [wantQr, setWantQr] = useState(!!view.upi?.due);
  const [qr, setQr] = useState<{ uri: string; dataUrl: string | null } | null>(null);
  const printed = useRef(false);
  const mounted = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );

  const uri = view.upi && wantQr ? view.upi.uri : null;
  useEffect(() => {
    if (!uri) return;
    let cancelled = false;
    void qrDataUrl(uri, 320).then((dataUrl) => !cancelled && setQr({ uri, dataUrl }));
    return () => {
      cancelled = true;
    };
  }, [uri]);
  const upiQr = uri && qr?.uri === uri ? qr.dataUrl : null;
  const ready = !uri || qr?.uri === uri;

  useEffect(() => {
    if (!autoPrint || !ready || printed.current) return;
    printed.current = true;
    // Let the QR image paint before the print dialog freezes the page.
    const timer = window.setTimeout(() => window.print(), 250);
    return () => window.clearTimeout(timer);
  }, [autoPrint, ready]);

  const slip = <ThermalReceipt view={view} logoSrc={null} upiQr={upiQr} cashier={row.cashier} />;

  return (
    <>
      {/* Built from two fixed paper widths only (no user input), so injecting the CSS as-is is safe. */}
      <style dangerouslySetInnerHTML={{ __html: thermalCss(paper) + PRINT_ONLY_CSS }} />
      {row.status !== "synced" ? (
        <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900">
          <CloudOff className="mt-0.5 size-4 shrink-0" aria-hidden />
          This bill is on this device only until it syncs.
        </p>
      ) : null}
      {row.reissuedFrom ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900">
          This bill was first printed as <span className="tabular font-medium">{row.reissuedFrom}</span>. Give the customer this copy and destroy the old one.
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-lg bg-zinc-100 py-1">{slip}</div>
      {view.upi ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-[var(--primary)]" checked={wantQr} onChange={(e) => setWantQr(e.target.checked)} />
          Print the UPI QR code
        </label>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button type="button" autoFocus disabled={!ready} onClick={() => window.print()}>
          <Printer aria-hidden /> Print
        </Button>
      </DialogFooter>
      {mounted ? createPortal(<div className={PRINT_ROOT}>{slip}</div>, document.body) : null}
    </>
  );
}

/** Loads a queued bill by its client_uuid and shows its slip. Used right after "Saved offline" and from the pending list. */
export function QueuedReceipt({
  businessId,
  clientUuid,
  autoPrint,
  onClose,
}: {
  businessId: string;
  clientUuid: string | null;
  autoPrint?: boolean;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<QueueRow | null>(null);

  useEffect(() => {
    if (!clientUuid) return;
    let cancelled = false;
    void getOfflineRepo(businessId)
      ?.getQueueRow(clientUuid)
      .then((row) => !cancelled && setLoaded(row ?? null))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [businessId, clientUuid]);

  const row = clientUuid && loaded?.clientUuid === clientUuid ? loaded : null;
  return <OfflineReceiptDialog row={row} autoPrint={autoPrint} onClose={onClose} />;
}
