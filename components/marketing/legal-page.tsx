import Link from "next/link";
import { FileWarning } from "lucide-react";

export type LegalSection = {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
};

/** Visible stand-ins. Real values are filled in after legal review, never invented. */
export const PLACEHOLDER = {
  company: "[company legal name]",
  address: "[registered address]",
  email: "[contact email]",
  law: "[to be confirmed]",
} as const;

function slug(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Shared prose layout for the policy pages. Every page carries the draft notice at the top. */
export function LegalPage({
  title,
  intro,
  sections,
  draft = true,
}: {
  title: string;
  intro: string;
  sections: LegalSection[];
  draft?: boolean;
}) {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 lg:py-16">
      <p className="font-mono text-xs font-semibold tracking-[0.18em] text-brand uppercase">EkDum</p>
      <h1 className="mt-3 text-4xl leading-tight font-black tracking-tight sm:text-5xl">{title}</h1>

      {draft ? (
        <div role="note" className="mt-6 flex gap-3 rounded-2xl border-2 border-dashed border-saffron bg-saffron/10 p-4">
          <FileWarning className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div className="text-sm leading-relaxed">
            <p className="font-bold">Placeholder draft, pending legal review.</p>
            <p className="mt-1">
              This page is an outline of what we intend the final document to cover. It has not been reviewed by a
              lawyer and is not yet a binding policy. Text in [square brackets] is still to be filled in.
            </p>
          </div>
        </div>
      ) : null}

      <p className="mt-6 text-lg leading-relaxed text-muted-foreground">{intro}</p>

      <nav aria-label="On this page" className="mt-8 rounded-2xl border bg-muted/40 p-4">
        <h2 className="text-sm font-semibold">On this page</h2>
        <ol className="mt-2 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
          {sections.map((section, index) => (
            <li key={section.heading}>
              <a href={`#${slug(section.heading)}`} className="hover:text-foreground hover:underline">
                {index + 1}. {section.heading}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-10 space-y-10">
        {sections.map((section, index) => (
          <section key={section.heading} aria-labelledby={slug(section.heading)} className="scroll-mt-20">
            <h2 id={slug(section.heading)} className="text-xl font-bold tracking-tight sm:text-2xl">
              <span aria-hidden className="mr-2 font-mono text-base text-brand">
                {String(index + 1).padStart(2, "0")}
              </span>
              {section.heading}
            </h2>
            {section.paragraphs?.map((paragraph) => (
              <p key={paragraph} className="mt-3 leading-relaxed text-foreground/80">
                {paragraph}
              </p>
            ))}
            {section.bullets ? (
              <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed text-foreground/80 marker:text-brand">
                {section.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>

      <p className="mt-12 border-t pt-6 text-sm text-muted-foreground">
        See also:{" "}
        <Link href="/privacy" className="underline hover:text-foreground">
          Privacy
        </Link>
        ,{" "}
        <Link href="/terms" className="underline hover:text-foreground">
          Terms
        </Link>
        ,{" "}
        <Link href="/refund-policy" className="underline hover:text-foreground">
          Refund policy
        </Link>{" "}
        and{" "}
        <Link href="/about" className="underline hover:text-foreground">
          About
        </Link>
        .
      </p>
    </article>
  );
}
