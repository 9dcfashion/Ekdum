import { redirect } from "next/navigation";
import { homePathFor, requireContext } from "@/lib/auth/context";

/** /app → the first page this user's role can open. */
export default async function AppIndex() {
  const ctx = await requireContext();
  redirect(homePathFor(ctx));
}
