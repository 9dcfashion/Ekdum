import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getUser } from "@/lib/auth/context";
import { isSupabaseConfigured } from "@/lib/env";
import { loadInvite } from "@/lib/staff/invites";
import { AcceptExistingButton, AcceptInviteForm } from "./accept-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Accept invite", robots: { index: false } };

export default async function AcceptInvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;

  if (!isSupabaseConfigured()) {
    return <Problem message="The app is not connected to Supabase yet." />;
  }

  let result: Awaited<ReturnType<typeof loadInvite>>;
  try {
    result = await loadInvite(token);
  } catch {
    return <Problem message="Invites are not available right now. Please try again later." />;
  }
  if (!result.invite) return <Problem message={result.reason ?? "This invite link is not valid."} />;

  const { invite } = result;
  const auth = await getUser();
  const signedInEmail = auth?.user.email?.toLowerCase();

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Join {invite.businessName}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        You have been invited as <span className="font-medium text-foreground">{invite.roleName}</span> for{" "}
        <span className="font-medium text-foreground">{invite.email}</span>.
      </p>

      {signedInEmail === invite.email ? (
        <AcceptExistingButton token={token} />
      ) : signedInEmail ? (
        <div className="mt-6 rounded-xl border bg-muted/40 p-4 text-sm">
          You are signed in as {signedInEmail}. Sign out and open this link again to accept the invite for{" "}
          {invite.email}.
        </div>
      ) : (
        <>
          <AcceptInviteForm token={token} defaultName={invite.fullName ?? ""} />
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Already have an EkDum account with this email?{" "}
            <Link
              href={`/login?next=${encodeURIComponent(`/accept-invite?token=${token}`)}`}
              className="font-medium text-primary hover:underline"
            >
              Sign in to accept
            </Link>
          </p>
        </>
      )}
    </>
  );
}

function Problem({ message }: { message: string }) {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Invite unavailable</h1>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      <Button asChild className="mt-6">
        <Link href="/login">Go to sign in</Link>
      </Button>
    </>
  );
}
