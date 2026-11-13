import type { Metadata } from "next";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { isSupabaseConfigured } from "@/lib/env";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Sign in" };

const MESSAGES: Record<string, string> = {
  link: "That link has expired or was already used. Please sign in, or request a new link.",
  verified: "Email verified. You can sign in now.",
  reset: "Password updated. Sign in with your new password.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const message = sp.error ? MESSAGES[sp.error] : sp.notice ? MESSAGES[sp.notice] : undefined;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-1 text-sm text-muted-foreground">Sign in to your shop.</p>

      {!isSupabaseConfigured() ? (
        <Alert className="mt-5">
          <AlertDescription>
            The app is not connected to Supabase yet.{" "}
            <Link href="/setup" className="font-medium underline">
              See setup steps
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}
      {message ? (
        <Alert className="mt-5">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      <LoginForm next={sp.next} />

      <p className="mt-6 text-center text-sm text-muted-foreground">
        New to EkDum?{" "}
        <Link href="/signup" className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
