import { Hourglass } from "lucide-react";
import { signOutAction } from "@/app/(auth)/actions";
import { Logo } from "@/components/brand";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Almost ready" };

/** Shown to staff whose owner has not finished setting the business up yet. */
export default function AppPendingPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <Logo />
      <Hourglass className="mt-8 size-8 text-muted-foreground" aria-hidden />
      <h1 className="mt-3 text-xl font-semibold">Your shop is still being set up</h1>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        The owner has not finished setting up the business yet. Please check back in a little while.
      </p>
      <form action={signOutAction} className="mt-6">
        <Button variant="outline">Sign out</Button>
      </form>
    </main>
  );
}
