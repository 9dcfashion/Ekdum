import { Button, Link, Text } from "@react-email/components";
import { EmailLayout, buttonStyle, textStyle } from "./layout";

export interface InvoiceEmailProps {
  businessName: string;
  brandColor: string;
  customerName?: string | null;
  documentTitle: string;
  invoiceNumber: string;
  invoiceDate: string;
  amount: string;
  publicUrl: string;
  businessPhone?: string | null;
}

export function InvoiceEmail(p: InvoiceEmailProps) {
  return (
    <EmailLayout
      preview={`Your bill ${p.invoiceNumber} from ${p.businessName} for ${p.amount}`}
      brandColor={p.brandColor}
      heading={p.businessName}
      footer={`${p.businessName}${p.businessPhone ? ` · ${p.businessPhone}` : ""} · Sent with EkDum, powered by NineAgents`}
    >
      <Text style={textStyle}>Hi{p.customerName ? ` ${p.customerName}` : ""},</Text>
      <Text style={textStyle}>
        Thank you for shopping with us. Your {p.documentTitle.toLowerCase()} is attached to this email as a PDF.
      </Text>
      <Text style={{ ...textStyle, backgroundColor: "#f4f4f5", borderRadius: 8, padding: "12px 14px" }}>
        <strong>{p.documentTitle}:</strong> {p.invoiceNumber}
        <br />
        <strong>Date:</strong> {p.invoiceDate}
        <br />
        <strong>Amount:</strong> {p.amount}
      </Text>
      <Button href={p.publicUrl} style={buttonStyle(p.brandColor)}>
        View bill online
      </Button>
      <Text style={{ ...textStyle, color: "#71717a", fontSize: 12, marginTop: 16 }}>
        Or open this link: <Link href={p.publicUrl}>{p.publicUrl}</Link>
      </Text>
    </EmailLayout>
  );
}

export function invoiceEmailText(p: InvoiceEmailProps): string {
  return [
    `Hi${p.customerName ? ` ${p.customerName}` : ""},`,
    "",
    `Thank you for shopping at ${p.businessName}. Your ${p.documentTitle.toLowerCase()} is attached.`,
    "",
    `${p.documentTitle}: ${p.invoiceNumber}`,
    `Date: ${p.invoiceDate}`,
    `Amount: ${p.amount}`,
    "",
    `View it online: ${p.publicUrl}`,
  ].join("\n");
}
