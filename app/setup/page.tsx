import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand";
import { isSupabaseConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

export const metadata = { title: "Connect Supabase", robots: { index: false } };

const STEPS: Array<{ title: string; body: React.ReactNode }> = [
  {
    title: "Create a Supabase project",
    body: (
      <>
        At supabase.com, create a project in the <strong>Mumbai (ap-south-1)</strong> region.
      </>
    ),
  },
  {
    title: "Run the database script",
    body: (
      <>
        Open the SQL Editor, paste the contents of <code>supabase/ekdum_schema.sql</code> and run it once. It creates
        every table, security policy and function.
      </>
    ),
  },
  {
    title: "Add your keys",
    body: (
      <>
        From Project Settings → API, copy the project URL, the anon (publishable) key and the service-role (secret) key
        into <code>.env.local</code>. Also set <code>JOBS_SECRET</code> to a long random string.
      </>
    ),
  },
  {
    title: "Allow the app URL in Auth",
    body: (
      <>
        Under Authentication → URL Configuration, set the Site URL to <code>http://localhost:3000</code> and add{" "}
        <code>http://localhost:3000/auth/confirm</code> to the redirect URLs.
      </>
    ),
  },
  { title: "Restart the dev server", body: <>Stop <code>pnpm dev</code> and start it again so the new keys load.</> },
];

export default function SetupPage() {
  if (isSupabaseConfigured()) redirect("/login");
  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <Logo />
      <h1 className="mt-8 text-2xl font-semibold tracking-tight">Connect your database</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        EkDum is running, but it is not connected to Supabase yet. Five steps and you are in.
      </p>
      <ol className="mt-6 space-y-4">
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex gap-3 rounded-xl border p-4">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {i + 1}
            </span>
            <div>
              <p className="font-medium">{step.title}</p>
              <p className="mt-0.5 text-sm text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-xs">
                {step.body}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-6 text-sm text-muted-foreground">
        The full guide is in <code className="rounded bg-muted px-1 text-xs">docs/RUNBOOK.md</code>.{" "}
        <Link href="/" className="font-medium text-primary hover:underline">
          Back to home
        </Link>
      </p>
    </main>
  );
}
