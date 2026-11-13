import { FileX2 } from "lucide-react";

export default function PublicInvoiceNotFound() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      <FileX2 className="size-10 text-muted-foreground" aria-hidden />
      <h1 className="mt-4 text-lg font-semibold">This bill is not available</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The link may be wrong, or the shop may have turned it off. Please ask the shop for a new link.
      </p>
      <p className="mt-10 text-xs text-muted-foreground">Powered by EkDum · NineAgents</p>
    </main>
  );
}
