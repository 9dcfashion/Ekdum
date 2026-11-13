import type { Metadata } from "next";
import { LegalPage, PLACEHOLDER, type LegalSection } from "@/components/marketing/legal-page";

export const metadata: Metadata = {
  title: "Privacy policy (draft)",
  description: "Placeholder draft of the EkDum privacy policy, pending legal review. Outlines what data we collect, how it is used and where it is stored.",
  alternates: { canonical: "/privacy" },
};

const SECTIONS: LegalSection[] = [
  {
    heading: "Who we are",
    paragraphs: [
      `EkDum is operated by ${PLACEHOLDER.company}, ${PLACEHOLDER.address}, and is powered by NineAgents. In this draft, "we" means that company and "you" means the shop owner or staff member using EkDum.`,
      "Your shop's own customers and vendors also appear in EkDum because you enter them. For that information you decide what is collected and why, and we handle it on your behalf.",
    ],
  },
  {
    heading: "What data we collect",
    bullets: [
      "Account details: your name, email address, phone number and password (stored only in hashed form by our authentication provider).",
      "Business details: business name, addresses, GSTIN and GST scheme, logo, invoice settings, and bank or UPI details that you choose to print on invoices.",
      "Shop records you create: products, stock movements, purchase bills and their attachments, invoices, payments, credit notes, shipments and receipt photos.",
      "Your customers' and vendors' details that you enter: names, phone numbers, email addresses, addresses and GSTINs.",
      "Staff accounts you invite, their roles, and a log of sensitive actions such as cancellations.",
      "Technical data: device and browser type, IP address, and basic logs needed to run and secure the service.",
    ],
  },
  {
    heading: "How we use it",
    bullets: [
      "To provide the service: making invoices, tracking stock, running reports and syncing bills made offline.",
      "To send receipts and notifications that you or your staff trigger, by email or WhatsApp.",
      "To keep accounts secure, prevent abuse and fix problems.",
      "To contact you about your account or important changes to the service.",
    ],
    paragraphs: ["We do not sell your data, and we do not use your shop's records for advertising."],
  },
  {
    heading: "Where it is stored",
    paragraphs: [
      "The EkDum database and file storage are hosted in India (Mumbai region). Some processors listed below may handle limited data, such as an email being delivered, on servers outside India. The final policy will set this out for each processor.",
      "On devices where you use the billing counter, a copy of your product list and any bills waiting to sync are kept in the browser's storage so that billing works offline.",
    ],
  },
  {
    heading: "Who processes data for us",
    paragraphs: ["We use a small number of service providers to run EkDum. They process data only to provide their service to us."],
    bullets: [
      "Supabase: database, authentication and file storage.",
      "Vercel: hosting of the web application.",
      "Resend: delivery of emails such as receipts and account emails.",
      "Meta (WhatsApp Business Platform): delivery of WhatsApp messages, only if you connect your own WhatsApp Business account.",
    ],
  },
  {
    heading: "How long we keep it",
    paragraphs: [
      "We keep your data while your account is active. Tax law may require you to keep invoices and related records for a number of years, so think about that before deleting anything. The retention periods after an account is closed are [to be confirmed].",
    ],
  },
  {
    heading: "Your rights",
    paragraphs: [
      "You can view and correct most of your information inside EkDum, and download reports as CSV. You can ask us for access to, correction of or deletion of your personal data, and you can withdraw consent where we rely on it. The final policy will describe these rights under applicable Indian law, including the Digital Personal Data Protection Act, 2023, and how to raise a grievance.",
      "If you are a customer of a shop that uses EkDum, please contact that shop first. They control the records they hold about you.",
    ],
  },
  {
    heading: "Cookies",
    paragraphs: [
      "EkDum uses the cookies and browser storage needed to keep you signed in and to make offline billing work. The final policy will list them, along with any analytics we add.",
    ],
  },
  {
    heading: "Changes to this policy",
    paragraphs: ["When this draft is replaced by a reviewed policy, and whenever that policy changes in an important way, we will update this page and tell account owners."],
  },
  {
    heading: "Contact",
    paragraphs: [`Questions or requests about privacy: ${PLACEHOLDER.email}. Postal address: ${PLACEHOLDER.company}, ${PLACEHOLDER.address}. Grievance officer: [to be confirmed].`],
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      intro="This is how we plan to handle the information you put into EkDum, in plain English."
      sections={SECTIONS}
    />
  );
}
