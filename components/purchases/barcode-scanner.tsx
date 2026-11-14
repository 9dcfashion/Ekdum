"use client";

import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";
import { CameraOff, Loader2, ScanBarcode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** The Shape Detection API is not in TypeScript's DOM types yet, so only what is used here is described. */
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorInstance {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorClass = new (options?: { formats?: string[] }) => BarcodeDetectorInstance;

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93", "itf", "qr_code"];

function detectorClass(): BarcodeDetectorClass | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { BarcodeDetector?: BarcodeDetectorClass }).BarcodeDetector ?? null;
}

const noSubscribe = () => () => {};

/** True only in browsers that can read barcodes from the camera (e.g. Chrome on Android). False on the server. */
export function useBarcodeScanSupport(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => detectorClass() !== null && !!navigator.mediaDevices?.getUserMedia,
    () => false,
  );
}

export interface ScanOutcome {
  ok: boolean;
  message: string;
}

/**
 * Camera barcode scanner. Keeps scanning so several items can be added in a
 * row; the same code is ignored for a moment so one item is not added twice by
 * accident. The camera is switched off as soon as the dialog closes.
 */
export function BarcodeScannerDialog({
  open,
  onClose,
  onCode,
}: {
  open: boolean;
  onClose: () => void;
  onCode: (code: string) => Promise<ScanOutcome>;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-[calc(100%-1rem)] gap-3 p-3 sm:max-w-md">
        <DialogHeader className="pr-8">
          <DialogTitle className="text-lg">Scan barcode</DialogTitle>
          <DialogDescription>Point the camera at the barcode on the item.</DialogDescription>
        </DialogHeader>
        {open ? <ScannerBody onCode={onCode} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Start the back camera on `video` and read barcodes from it four times a
 * second. The same code is ignored for 2.5 seconds. Returns a function that
 * stops scanning and switches the camera off.
 */
function startScanning(
  video: HTMLVideoElement,
  handlers: { onReady: () => void; onCode: (code: string) => Promise<void>; onFail: (message: string) => void },
): () => void {
  let stream: MediaStream | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let busy = false;
  let recent = { code: "", at: 0 };

  async function readFrame(detector: BarcodeDetectorInstance) {
    if (busy || stopped || video.readyState < 2) return;
    busy = true;
    try {
      const found = await detector.detect(video);
      const code = found[0]?.rawValue?.trim();
      const now = Date.now();
      if (code && !(code === recent.code && now - recent.at < 2500)) {
        recent = { code, at: now };
        navigator.vibrate?.(60);
        await handlers.onCode(code);
      }
    } catch {
      // a frame that could not be read; try the next one
    }
    busy = false;
  }

  async function start() {
    const Detector = detectorClass();
    if (!Detector) throw new Error("Scanning is not available in this browser.");
    let detector: BarcodeDetectorInstance;
    try {
      detector = new Detector({ formats: FORMATS });
    } catch {
      detector = new Detector(); // some browsers reject formats they do not know
    }
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    if (stopped) return;
    video.srcObject = stream;
    await video.play();
    if (stopped) return;
    handlers.onReady();
    timer = setInterval(() => void readFrame(detector), 250);
  }

  start().catch((error: unknown) => {
    if (stopped) return;
    const name = error instanceof DOMException ? error.name : "";
    handlers.onFail(
      name === "NotAllowedError"
        ? "Camera permission was refused. Allow the camera for this site in your browser settings, or type the code in the search box."
        : name === "NotFoundError"
          ? "No camera was found on this device."
          : "The camera could not be started. Type the code in the search box instead.",
    );
  });

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
    stream?.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
}

function ScannerBody({ onCode, onClose }: { onCode: (code: string) => Promise<ScanOutcome>; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"starting" | "scanning" | "failed">("starting");
  const [failure, setFailure] = useState("");
  const [last, setLast] = useState<ScanOutcome | null>(null);
  const handleCode = useEffectEvent(async (code: string) => setLast(await onCode(code)));

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    return startScanning(video, {
      onReady: () => setStatus("scanning"),
      onCode: (code) => handleCode(code),
      onFail: (message) => {
        setFailure(message);
        setStatus("failed");
      },
    });
  }, []);

  return (
    <div className="grid gap-3">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} className="size-full object-cover" playsInline muted autoPlay />
        {status === "scanning" ? (
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-lg border-2 border-white/80" aria-hidden />
        ) : null}
        {status !== "scanning" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-white">
            {status === "starting" ? <Loader2 className="size-8 animate-spin" aria-hidden /> : <CameraOff className="size-8" aria-hidden />}
            <span>{status === "starting" ? "Starting camera" : failure}</span>
          </div>
        ) : null}
      </div>
      <p
        role="status"
        className={cn(
          "flex min-h-12 items-center gap-2 rounded-lg px-3 py-2 text-base",
          last ? (last.ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900") : "bg-muted text-muted-foreground",
        )}
      >
        <ScanBarcode className="size-5 shrink-0" aria-hidden />
        {last ? last.message : "Waiting for a barcode"}
      </p>
      <Button type="button" className="h-12 text-base" onClick={onClose}>
        Done
      </Button>
    </div>
  );
}
