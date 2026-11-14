/**
 * Sharing a saved bill from the till without any WhatsApp API: a wa.me link
 * that opens WhatsApp with the message typed in, and the text for the phone's
 * own share sheet. Pure functions, unit tested.
 */
import { normaliseMobile } from "@/lib/gst";
import { formatINR } from "@/lib/money";

/**
 * An Indian mobile number in the form wa.me wants: country code + 10 digits, no "+".
 * "98765 43210", "+91 98765-43210" and "098765 43210" all give "919876543210". Null when it is not a valid mobile.
 */
export function waNumber(input: string | null | undefined): string | null {
  const e164 = normaliseMobile(input);
  return e164 ? e164.slice(1) : null;
}

/** The public page of a bill: `${origin}/i/${token}`. */
export function billLink(origin: string, publicToken: string): string {
  return `${origin.replace(/\/+$/, "")}/i/${encodeURIComponent(publicToken)}`;
}

/** The short message sent with a bill. Plain words, one fact per line. */
export function billShareText(args: { businessName: string; invoiceNumber: string; totalPaise: number; link?: string | null }): string {
  const shop = args.businessName.trim();
  const lines = [
    shop ? `Thank you for shopping at ${shop}.` : "Thank you for shopping with us.",
    `Bill ${args.invoiceNumber}: ${formatINR(args.totalPaise)}`,
  ];
  if (args.link) lines.push(`See your bill: ${args.link}`);
  return lines.join("\n");
}

/**
 * A wa.me link that opens a chat with the message filled in.
 * With a valid number it opens that customer's chat; without one WhatsApp asks whom to send it to.
 */
export function whatsappUrl(text: string, phone?: string | null): string {
  const number = waNumber(phone);
  return `https://wa.me/${number ?? ""}?text=${encodeURIComponent(text)}`;
}
