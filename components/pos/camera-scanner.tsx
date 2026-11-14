"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { CheckCircle2, Loader2, ScanBarcode, TriangleAlert, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** The parts of the BarcodeDetector API we use (not in TypeScript's DOM types yet). */
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorClass {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

const WANTED_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "qr_code"];
const SCAN_EVERY_MS = 150;
/** The same code seen again within this time is the same scan, not a second item. */
const SAME_CODE_MS = 2000;

export type ScanOutcome = { ok: true; message: string } | { ok: false; message: string };

type Status = { kind: "starting" } | { kind: "scanning" } | { kind: "failed"; message: string };

function cameraError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "The camera is blocked for this site. Allow the camera in your browser settings, or close this and type the item name.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera was found on this device.";
  if (name === "NotReadableError") return "The camera is being used by another app. Close that app and try again.";
  return "Could not start the camera. Close this and type the item name instead.";
}

function buzz(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Some browsers throw when vibration is not allowed; it is only a nice extra.
  }
}

function ScannerBody({ onDetected, onClose }: { onDetected: (code: string) => ScanOutcome; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "starting" });
  const [many, setMany] = useState(false);
  const [last, setLast] = useState<ScanOutcome | null>(null);
  const lastCode = useRef<{ code: string; at: number } | null>(null);

  const handleCode = useEffectEvent((code: string) => {
    const now = Date.now();
    const previous = lastCode.current;
    if (previous && previous.code === code && now - previous.at < SAME_CODE_MS) return;
    lastCode.current = { code, at: now };
    const outcome = onDetected(code);
    setLast(outcome);
    buzz(outcome.ok ? 80 : [40, 60, 40]);
    if (outcome.ok && !many) onClose();
  });

  useEffect(() => {
    const video = videoRef.current;
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function start() {
      const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorClass }).BarcodeDetector;
      if (!Detector || !navigator.mediaDevices?.getUserMedia) {
        setStatus({ kind: "failed", message: "This browser cannot scan with the camera. Type the item name instead." });
        return;
      }
      let formats = WANTED_FORMATS;
      try {
        const supported = (await Detector.getSupportedFormats?.()) ?? WANTED_FORMATS;
        formats = WANTED_FORMATS.filter((f) => supported.includes(f));
      } catch {
        formats = WANTED_FORMATS;
      }
      if (formats.length === 0) {
        setStatus({ kind: "failed", message: "This phone cannot read barcodes with the camera. Type the item name instead." });
        return;
      }
      let detector: BarcodeDetectorLike;
      try {
        detector = new Detector({ formats });
      } catch {
        setStatus({ kind: "failed", message: "This phone cannot read barcodes with the camera. Type the item name instead." });
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch (error) {
        if (!stopped) setStatus({ kind: "failed", message: cameraError(error) });
        return;
      }
      // Closed while the permission prompt was up: let the camera go at once.
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      if (!video) return;
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // Autoplay of a muted inline video is allowed; if it still fails the frames below simply never arrive.
      }
      if (stopped) return;
      setStatus({ kind: "scanning" });

      const tick = async () => {
        if (stopped) return;
        if (video.readyState >= 2) {
          try {
            const codes = await detector.detect(video);
            const code = codes.find((c) => c.rawValue.trim())?.rawValue.trim();
            if (code && !stopped) handleCode(code);
          } catch {
            // A frame that could not be read; try the next one.
          }
        }
        if (!stopped) timer = setTimeout(tick, SCAN_EVERY_MS);
      };
      void tick();
    }

    void start();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      if (video) video.srcObject = null;
    };
  }, []);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-black text-white">
      <video ref={videoRef} muted playsInline autoPlay aria-hidden className="absolute inset-0 size-full object-cover" />

      {/* Darkened edges with a clear window where the barcode should go. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
        <div className="aspect-[3/2] w-[80%] max-w-sm rounded-2xl border-4 border-white/90 shadow-[0_0_0_100vmax_rgba(0,0,0,0.5)]" />
      </div>

      <div className="relative flex items-center gap-2 p-2">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the camera"
          className="flex size-12 items-center justify-center rounded-full bg-black/50 outline-none focus-visible:ring-3 focus-visible:ring-white/70"
        >
          <X className="size-6" aria-hidden />
        </button>
        <p className="min-w-0 flex-1 truncate text-base font-medium">Scan a barcode</p>
        <button
          type="button"
          aria-pressed={many}
          onClick={() => setMany(!many)}
          className={cn(
            "h-12 rounded-full px-4 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-white/70",
            many ? "bg-white text-black" : "bg-black/50 text-white",
          )}
        >
          {many ? "Scanning many: on" : "Scan many"}
        </button>
      </div>

      <div className="relative mt-auto grid gap-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="min-h-16 rounded-xl bg-black/70 p-3 text-base" role="status" aria-live="polite">
          {status.kind === "failed" ? (
            <p className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-300" aria-hidden />
              {status.message}
            </p>
          ) : status.kind === "starting" ? (
            <p className="flex items-center gap-2">
              <Loader2 className="size-5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden /> Starting the camera…
            </p>
          ) : last ? (
            <p className={cn("flex items-start gap-2", last.ok ? "text-emerald-300" : "text-amber-300")}>
              {last.ok ? <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden /> : <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />}
              <span className="text-white">{last.message}</span>
            </p>
          ) : (
            <p className="flex items-center gap-2">
              <ScanBarcode className="size-5 shrink-0" aria-hidden /> Hold the barcode inside the box.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="h-12 rounded-xl bg-white text-base font-medium text-black outline-none focus-visible:ring-3 focus-visible:ring-white/70"
        >
          {many ? "Done" : "Type instead"}
        </button>
      </div>
    </div>
  );
}

/**
 * Full-screen camera view that reads a barcode and adds the item (Chrome on
 * Android). The camera is switched off the moment the view closes.
 */
export function CameraScanner({
  open,
  onOpenChange,
  onDetected,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Add the item for this code. The message is shown on the camera view. */
  onDetected: (code: string) => ScanOutcome;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="inset-0 top-0 left-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none bg-black p-0 text-white ring-0 sm:max-w-none motion-reduce:animate-none!"
      >
        <DialogTitle className="sr-only">Scan a barcode</DialogTitle>
        <DialogDescription className="sr-only">Point the back camera at the barcode on the item. It is added to the bill when it is read.</DialogDescription>
        {/* Rendered only while open, so closing stops the camera at once (not after the closing animation). */}
        {open ? <ScannerBody onDetected={onDetected} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}
