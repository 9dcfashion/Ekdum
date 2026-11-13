import { Button, Link, Text } from "@react-email/components";
import { EmailLayout, buttonStyle, textStyle } from "./layout";

export interface InviteEmailProps {
  businessName: string;
  inviterName: string;
  inviteeName?: string | null;
  roleName: string;
  acceptUrl: string;
  expiresInDays: number;
}

export function InviteEmail({ businessName, inviterName, inviteeName, roleName, acceptUrl, expiresInDays }: InviteEmailProps) {
  return (
    <EmailLayout preview={`${inviterName} invited you to ${businessName} on EkDum`} heading="EkDum">
      <Text style={textStyle}>Hi{inviteeName ? ` ${inviteeName}` : ""},</Text>
      <Text style={textStyle}>
        {inviterName} has invited you to join <strong>{businessName}</strong> on EkDum as <strong>{roleName}</strong>.
      </Text>
      <Button href={acceptUrl} style={buttonStyle("#4338CA")}>
        Accept invite
      </Button>
      <Text style={{ ...textStyle, color: "#71717a", fontSize: 12, marginTop: 16 }}>
        This link works for {expiresInDays} days. If the button does not work, copy this link into your browser:{" "}
        <Link href={acceptUrl}>{acceptUrl}</Link>
      </Text>
      <Text style={{ ...textStyle, color: "#71717a", fontSize: 12 }}>
        If you were not expecting this, you can ignore this email.
      </Text>
    </EmailLayout>
  );
}

export function inviteEmailText(p: InviteEmailProps): string {
  return [
    `Hi${p.inviteeName ? ` ${p.inviteeName}` : ""},`,
    "",
    `${p.inviterName} has invited you to join ${p.businessName} on EkDum as ${p.roleName}.`,
    "",
    `Accept the invite: ${p.acceptUrl}`,
    "",
    `This link works for ${p.expiresInDays} days.`,
  ].join("\n");
}
