import type { Metadata } from "next";
import { LegalPage, PLACEHOLDER, type LegalSection } from "@/components/marketing/legal-page";

export const metadata: Metadata = {
  title: "Refund policy (draft)",
  description: "Placeholder draft of the EkDum refund and cancellation policy, pending legal review.",
  alternates: { canonical: "/refund-policy" },
};

const SECTIONS: LegalSection[] = [
  {
    heading: "Where things stand today",
    paragraphs: [
      "EkDum is in beta and early access is free. We do not charge anything and we do not take payments for EkDum itself, so right now there is nothing to refund.",
    ],
  },
  {
    heading: "When paid plans arrive",
    paragraphs: [
      "Paid plans have not been announced and no prices have been decided. Before any paid plan starts, this page will be replaced with a reviewed policy covering:",
    ],
    bullets: [
      "how to cancel a plan and when the cancellation takes effect;",
      "whether and when refunds are given, and how they are paid;",
      "what happens to your data after you cancel.",
    ],
  },
  {
    heading: "Payments between you and your customers",
    paragraphs: [
      "EkDum records the payments your shop receives (cash, UPI, card and so on) but does not collect or hold that money. Refunds to your own customers are between you and them. EkDum helps you record them with a cancellation or a credit note.",
    ],
  },
  {
    heading: "Contact",
    paragraphs: [`Questions about this page: ${PLACEHOLDER.email}. ${PLACEHOLDER.company}, ${PLACEHOLDER.address}.`],
  },
];

export default function RefundPolicyPage() {
  return (
    <LegalPage
      title="Refund and cancellation policy"
      intro="Short version: EkDum is free during the beta, so there is nothing to refund yet."
      sections={SECTIONS}
    />
  );
}
