import { Body, Container, Head, Hr, Html, Preview, Section, Text } from "@react-email/components";

/** Shared frame for transactional emails. Inline styles only: email clients ignore stylesheets. */
export function EmailLayout({
  preview,
  brandColor = "#4338CA",
  heading,
  children,
  footer,
}: {
  preview: string;
  brandColor?: string;
  heading: string;
  children: React.ReactNode;
  footer?: string;
}) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: "#f4f4f5", fontFamily: "Helvetica, Arial, sans-serif", margin: 0, padding: "24px 0" }}>
        <Container style={{ backgroundColor: "#ffffff", borderRadius: 12, maxWidth: 520, overflow: "hidden" }}>
          <Section style={{ backgroundColor: brandColor, padding: "18px 28px" }}>
            <Text style={{ color: "#ffffff", fontSize: 18, fontWeight: 700, margin: 0 }}>{heading}</Text>
          </Section>
          <Section style={{ padding: "24px 28px 8px" }}>{children}</Section>
          <Hr style={{ borderColor: "#e4e4e7", margin: "8px 28px" }} />
          <Section style={{ padding: "4px 28px 20px" }}>
            <Text style={{ color: "#71717a", fontSize: 12, lineHeight: "18px", margin: 0 }}>
              {footer ?? "Sent with EkDum · Powered by NineAgents"}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export const textStyle = { color: "#18181b", fontSize: 14, lineHeight: "22px", margin: "0 0 12px" } as const;
export const buttonStyle = (color: string) =>
  ({
    backgroundColor: color,
    borderRadius: 8,
    color: "#ffffff",
    display: "inline-block",
    fontSize: 14,
    fontWeight: 600,
    padding: "10px 18px",
    textDecoration: "none",
  }) as const;
