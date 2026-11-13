import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/context";
import { ResetPasswordForm } from "./reset-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage() {
  // The reset link signs the user in (via /auth/confirm) before landing here.
  if (!(await getUser())) redirect("/login?error=link");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mt-1 text-sm text-muted-foreground">You will use this the next time you sign in.</p>
      <ResetPasswordForm />
    </>
  );
}
