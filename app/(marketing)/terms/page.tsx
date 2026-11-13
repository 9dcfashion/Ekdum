import type { Metadata } from "next";
import { LegalPage, PLACEHOLDER, type LegalSection } from "@/components/marketing/legal-page";

export const metadata: Metadata = {
  title: "Terms of service (draft)",
  description: "Placeholder draft of the EkDum terms of service, pending legal review.",
  alternates: { canonical: "/terms" },
};

const SECTIONS: LegalSection[] = [
  {
    heading: "About these terms",
    paragraphs: [
      `EkDum is provided by ${PLACEHOLDER.company}, ${PLACEHOLDER.address}. Once reviewed and published, these terms will be the agreement between that company and the business that signs up.`,
    ],
  },
  {
    heading: "Your account",
    bullets: [
      "You must give accurate details when you sign up and keep them up to date.",
      "The person who creates the business is its owner in EkDum and controls who else gets access.",
      "You are responsible for your staff's use of EkDum, and for keeping passwords and shared counter devices secure.",
      "Tell us promptly if you think someone has used your account without permission.",
    ],
  },
  {
    heading: "Acceptable use",
    paragraphs: ["You agree not to:"],
    bullets: [
      "use EkDum for anything unlawful, including issuing false or misleading invoices;",
      "try to access another business's data, or to break or overload the service;",
      "send spam or messages your customers have not agreed to receive, by email or WhatsApp;",
      "resell or copy the service without our written permission.",
    ],
  },
  {
    heading: "Your data",
    paragraphs: [
      "The records you put into EkDum belong to you. You give us permission to store and process them in order to run the service, as described in the privacy policy.",
    ],
  },
  {
    heading: "GST and tax accuracy",
    paragraphs: [
      "EkDum calculates tax and formats invoices from the settings and details that you enter: your GST scheme, GSTIN, HSN codes, GST rates, prices and place of supply. You are responsible for those being correct, and for your invoices, returns and filings.",
      "EkDum is a billing tool, not tax advice. It does not file returns and does not generate e-invoices or e-way bills. Please confirm your setup with your Chartered Accountant.",
    ],
  },
  {
    heading: "Beta and pricing",
    paragraphs: [
      "EkDum is currently in beta, and early access is free during the beta. Features may change. Paid plans have not been announced; when they are, their terms will be added here before anyone is charged.",
    ],
  },
  {
    heading: "Availability",
    paragraphs: [
      "We work to keep EkDum available and your data safe, but we do not promise uninterrupted service, especially during the beta. Offline billing depends on your device and browser; bills made offline are stored on that device until they sync, so do not clear the browser's data while bills are waiting.",
    ],
  },
  {
    heading: "Third-party services",
    paragraphs: [
      "Some features depend on other providers, for example email delivery or your own WhatsApp Business account. Their terms apply to your use of them, and we are not responsible for their outages or decisions.",
    ],
  },
  {
    heading: "Liability",
    paragraphs: [
      "The final terms will set out the limits of our liability to the extent the law allows. In outline: the service is provided as it is, we are not liable for indirect losses or for tax consequences of details you entered, and our total liability will be capped at an amount that is [to be confirmed].",
    ],
  },
  {
    heading: "Ending your use",
    paragraphs: [
      "You can stop using EkDum at any time. We may suspend or close an account that breaks these terms or puts the service or other users at risk. The final terms will describe how you can get a copy of your data when an account is closed.",
    ],
  },
  {
    heading: "Governing law",
    paragraphs: [`Governing law and the courts with jurisdiction: ${PLACEHOLDER.law}.`],
  },
  {
    heading: "Contact",
    paragraphs: [`Questions about these terms: ${PLACEHOLDER.email}. Postal address: ${PLACEHOLDER.company}, ${PLACEHOLDER.address}.`],
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of service"
      intro="The ground rules for using EkDum, in plain English."
      sections={SECTIONS}
    />
  );
}
