import { CheckCircle2 } from "lucide-react";
import { Logo, PoweredBy, TAGLINE } from "@/components/brand";

const POINTS = [
  "GST bills in seconds, on any device",
  "Stock, purchases and staff in one place",
  "Works even when the internet doesn't",
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-brand p-10 text-white lg:flex">
        <div aria-hidden className="absolute -top-24 -right-24 size-80 rounded-full bg-white/10" />
        <div aria-hidden className="absolute -bottom-32 -left-16 size-96 rounded-full bg-saffron/20" />
        <Logo tone="light" className="relative" />
        <div className="relative">
          <p className="text-3xl leading-tight font-semibold">{TAGLINE}</p>
          <ul className="mt-6 space-y-3 text-sm text-white/90">
            {POINTS.map((point) => (
              <li key={point} className="flex items-center gap-2">
                <CheckCircle2 className="size-4 shrink-0 text-saffron" aria-hidden /> {point}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/70">Powered by NineAgents</p>
      </aside>
      <main className="flex flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <Logo className="mb-8 lg:hidden" />
          {children}
          <PoweredBy className="mt-8 text-center" />
        </div>
      </main>
    </div>
  );
}
