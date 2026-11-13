import { redirect } from "next/navigation";

/** Pricing is not decided yet; the landing page section says so. */
export default function PricingPage() {
  redirect("/#pricing");
}
