import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { TAGLINE } from "@/components/brand";
import { PLACEHOLDER } from "@/components/marketing/legal-page";

export const metadata: Metadata = {
  title: "About",
  description: "EkDum is a shop OS for Indian retailers, powered by NineAgents. What we are building, and what is in the product today.",
  alternates: { canonical: "/about" },
};

const TODAY = [
  "GST billing and POS, with thermal and A4 printing",
  "Inventory with a stock ledger and low-stock alerts",
  "Purchase bills with photo attachments",
  "Staff logins with roles and permissions",
  "Digital receipts by email and WhatsApp",
  "A courier dispatch log with photo proof",
  "An owner dashboard and CSV reports",
];

export default function AboutPage() {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 lg:py-16">
      <p className="font-mono text-xs font-semibold tracking-[0.18em] text-brand uppercase">About EkDum</p>
      <h1 className="mt-3 text-4xl leading-tight font-black tracking-tight sm:text-6xl">{TAGLINE}</h1>

      <div className="mt-8 space-y-5 text-lg leading-relaxed text-foreground/80">
        <p>
          EkDum is a shop OS for Indian retailers. The idea is simple: a shop owner should be able to run billing,
          stock, purchases, staff and dispatch from one panel, instead of five tools that do not talk to each other.
        </p>
        <p>
          We are starting with the part that has to be right every single day: GST billing at the counter. It has to
          be fast, it has to get the tax right, and it has to keep working when the internet does not.
        </p>
      </div>

      <h2 className="mt-12 text-2xl font-bold tracking-tight">What is in the product today</h2>
      <ul className="mt-4 list-disc space-y-2 pl-5 leading-relaxed text-foreground/80 marker:text-brand">
        {TODAY.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <h2 className="mt-12 text-2xl font-bold tracking-tight">What comes next</h2>
      <p className="mt-4 leading-relaxed text-foreground/80">
        Google Business Profile (reviews and posts), Shopify sync and AI scanning of purchase bills are planned. They are
        not available yet, and we would rather say that plainly than put them on a feature list.
      </p>

      <h2 className="mt-12 text-2xl font-bold tracking-tight">Who is behind it</h2>
      <p className="mt-4 leading-relaxed text-foreground/80">
        EkDum is powered by NineAgents. EkDum is in beta, and early access is free while it is.
      </p>
      <dl className="mt-4 grid gap-3 rounded-2xl border bg-muted/40 p-5 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
        <dt className="font-semibold">Company</dt>
        <dd className="text-muted-foreground">{PLACEHOLDER.company}</dd>
        <dt className="font-semibold">Registered address</dt>
        <dd className="text-muted-foreground">{PLACEHOLDER.address}</dd>
        <dt className="font-semibold">Contact</dt>
        <dd className="text-muted-foreground">{PLACEHOLDER.email}</dd>
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">Details in [square brackets] are still to be filled in.</p>

      <div className="mt-10">
        <Link
          href="/signup"
          className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand px-6 text-base font-semibold text-white transition-colors hover:bg-brand/90"
        >
          Start free <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </article>
  );
}
