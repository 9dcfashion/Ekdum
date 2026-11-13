import type { Metadata } from "next";
import Link from "next/link";
import { Logo, PoweredBy } from "@/components/brand";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12 text-center">
      <Logo />
      <div
        aria-hidden
        className="mt-10 w-56 -rotate-2 bg-white px-5 pt-5 pb-4 font-mono text-xs text-neutral-700 shadow-lg ring-1 ring-black/5"
      >
        <p className="font-semibold tracking-widest">EKDUM</p>
        <p className="mt-2 border-t border-dashed border-neutral-300 pt-2 text-left">ITEM: THIS PAGE</p>
        <p className="flex justify-between">
          <span>QTY</span>
          <span>0</span>
        </p>
        <p className="mt-2 flex justify-between border-t border-dashed border-neutral-300 pt-2 text-base font-bold text-brand">
          <span>ERROR</span>
          <span>404</span>
        </p>
      </div>
      <h1 className="mt-10 text-3xl font-bold tracking-tight sm:text-4xl">Yeh page stock mein nahi hai.</h1>
      <p className="mt-3 max-w-md text-muted-foreground">
        The page you are looking for does not exist or has moved. Check the link, or head back and carry on.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button asChild size="lg" className="px-4">
          <Link href="/">Back to home</Link>
        </Button>
        <Button asChild size="lg" variant="outline" className="px-4">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
      <PoweredBy className="mt-10" />
    </main>
  );
}
