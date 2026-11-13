import Link from "next/link";
import { cn } from "@/lib/utils";

/** The EkDum wordmark: a rounded tile with a tick-like "E" and the name. */
export function Logo({ className, href = "/", tone = "dark" }: { className?: string; href?: string | null; tone?: "dark" | "light" }) {
  const mark = (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", tone === "light" ? "text-white" : "text-foreground", className)}>
      <span
        aria-hidden
        className={cn(
          "flex size-7 items-center justify-center rounded-lg text-sm font-black",
          tone === "light" ? "bg-white text-brand" : "bg-brand text-white",
        )}
      >
        E
      </span>
      <span className="text-lg leading-none">
        Ek<span className={tone === "light" ? "text-saffron" : "text-brand"}>Dum</span>
      </span>
    </span>
  );
  return href ? (
    <Link href={href} aria-label="EkDum home">
      {mark}
    </Link>
  ) : (
    mark
  );
}

export function PoweredBy({ className }: { className?: string }) {
  return <p className={cn("text-xs text-muted-foreground", className)}>Powered by NineAgents</p>;
}

export const TAGLINE = "Poora dhandha, ekdum sorted.";
