import type { CSSProperties, ReactNode } from "react";
import { financialYear } from "@/lib/dates";
import { DOCUMENT_TITLES, type DocumentType } from "@/lib/gst/config";
import { formatInvoiceNumber } from "@/lib/gst/numbering";
import { getState, stateLabel } from "@/lib/gst/states";

const NAVY = "#1F3864";
const LINE = "1px solid #000";
const SANS = 'Calibri, Carlito, "Helvetica Neue", Arial, sans-serif';
const SERIF = '"Times New Roman", Times, serif';
// Column widths of the A4 bill (lib/invoices/sheet.ts SHEET_GRID), so the sketch has its proportions.
const A = 9.5;
const F = 17.2;
const LEFT = 60;

function Box({
  w,
  children,
  center,
  right,
  style,
}: {
  w: number | string;
  children?: ReactNode;
  center?: boolean;
  right?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        boxSizing: "border-box",
        width: typeof w === "number" ? `${w}%` : w,
        flexShrink: 0,
        minHeight: 12,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "0 3px",
        borderRight: LINE,
        borderBottom: LINE,
        textAlign: center ? "center" : right ? "right" : "left",
        overflow: "hidden",
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

const Row = ({ children, top }: { children: ReactNode; top?: boolean }) => (
  <div style={{ display: "flex", borderLeft: LINE, borderTop: top ? LINE : undefined }}>{children}</div>
);

/**
 * A small, static sketch of the A4 bill (the shopkeeper's boxed format) used as a live
 * preview in onboarding and settings: logo box, shop name in the brand colour, the line
 * under it, the document title box, the item table, totals and the signature block.
 */
export function MiniInvoicePreview({
  name,
  address,
  gstin,
  stateCode,
  logoUrl,
  brandColor,
  documentType = "tax_invoice",
  prefix = "A",
  footer,
  tagline,
  signatoryLabel,
}: {
  name: string;
  address?: string | null;
  gstin?: string | null;
  stateCode?: string | null;
  logoUrl?: string | null;
  brandColor: string;
  documentType?: DocumentType;
  prefix?: string;
  footer?: string | null;
  /** The line under the shop name. */
  tagline?: string | null;
  /** The title under "For {shop}", e.g. "Proprietor". */
  signatoryLabel?: string | null;
}) {
  let number = "A/2627/00001";
  try {
    number = formatInvoiceNumber(prefix || "A", financialYear(), 1);
  } catch {
    /* keep the sample while the prefix is being typed */
  }
  const showTax = documentType === "tax_invoice";
  const cashMemo = documentType === "cash_memo";
  const accent: CSSProperties = { color: brandColor };
  const bold: CSSProperties = { fontWeight: 700 };
  const state = cashMemo ? (getState(stateCode)?.name ?? "") : stateLabel(stateCode);
  const addressRow = [address || "Shop address", state].filter(Boolean).join(", ");
  const shopName = name || "Your shop name";
  const line = tagline?.trim();
  const hsn = cashMemo ? 0 : 13.5;
  const desc = 100 - A - hsn - 10.2 - 12.6 - F;
  const items: Array<[string, string, string, string, string]> = [
    ["Sample item 1", "1006", "2", "500.00", "1,000.00"],
    ["Sample item 2", "1006", "1", "1,000.00", "1,000.00"],
  ];

  return (
    <div
      className="overflow-hidden rounded-lg border bg-white p-2.5 shadow-sm"
      style={{ color: NAVY, fontFamily: SANS, fontSize: 7.5, lineHeight: 1.2, fontVariantNumeric: "tabular-nums" }}
      aria-label="Invoice preview"
    >
      <Row top>
        <Box w={A} center style={{ alignItems: "center", padding: 2 }}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" style={{ width: 24, height: 24, objectFit: "contain" }} />
          ) : null}
        </Box>
        <div style={{ width: `${100 - A - F}%`, display: "flex", flexDirection: "column" }}>
          <Box
            w="100%"
            center
            style={{ ...accent, fontFamily: SERIF, fontWeight: 700, fontSize: 12, minHeight: line ? 17 : 28, flexGrow: line ? 0 : 1 }}
          >
            {shopName}
          </Box>
          {line ? (
            <Box w="100%" center style={{ ...accent, ...bold, fontSize: 6, minHeight: 11, flexGrow: 1 }}>
              {line}
            </Box>
          ) : null}
        </div>
        <Box w={F} center style={{ padding: 1 }}>
          <span style={{ ...bold, fontSize: 6.5, whiteSpace: "normal" }}>{DOCUMENT_TITLES[documentType].toUpperCase()}</span>
          <span style={{ fontSize: 4.5, color: "#44546A" }}>Original for Recipient</span>
        </Box>
      </Row>
      <Row>
        <Box w="100%" center style={{ ...bold, fontSize: 6 }}>
          {addressRow}
        </Box>
      </Row>
      <Row>
        <Box w={LEFT}>Details of Buyer : Sample Customer</Box>
        <Box w={100 - LEFT} style={gstin && !cashMemo ? { ...bold, ...accent } : undefined}>
          {gstin && !cashMemo ? `GSTIN : ${gstin}` : `${cashMemo ? "Bill" : "Invoice"} No: ${number}`}
        </Box>
      </Row>
      <Row>
        <Box w={LEFT} style={{ borderBottom: 0 }}>Market Road, City</Box>
        <Box w={100 - LEFT} style={{ borderBottom: 0 }}>
          {gstin && !cashMemo ? `Invoice No: ${number}` : ""}
        </Box>
      </Row>
      <Row top>
        <Box w={A} center style={bold}>Sr.No</Box>
        <Box w={desc} center style={bold}>Description of Goods</Box>
        {hsn ? <Box w={hsn} center style={bold}>HSN Code</Box> : null}
        <Box w={10.2} center style={bold}>Qty</Box>
        <Box w={12.6} center style={bold}>Rate</Box>
        <Box w={F} center style={bold}>Amount</Box>
      </Row>
      {items.map(([item, code, qty, rate, amount], i) => (
        <Row key={item}>
          <Box w={A} center>{i + 1}</Box>
          <Box w={desc}>{item}</Box>
          {hsn ? <Box w={hsn} center>{code}</Box> : null}
          <Box w={10.2} center>{qty}</Box>
          <Box w={12.6} center>{rate}</Box>
          <Box w={F} center>{amount}</Box>
        </Row>
      ))}
      <Row>
        <Box w={LEFT} />
        <Box w={100 - LEFT - F} center style={{ ...bold, fontSize: 6, whiteSpace: "normal" }}>
          {showTax ? "Total Taxable Amount" : "Total"}
        </Box>
        <Box w={F} center style={bold}>2,000.00</Box>
      </Row>
      {showTax ? (
        <div style={{ display: "flex", borderLeft: LINE }}>
          <Box w={LEFT} style={{ ...bold, ...accent }}>
            BANK DETAIL:- Your bank
          </Box>
          <div style={{ width: `${100 - LEFT}%`, display: "flex", flexDirection: "column" }}>
            {[
              ["Add SGST", "9%", "180.00"],
              ["Add CGST", "9%", "180.00"],
              ["Add IGST", "18%", ""],
            ].map(([label, rate, amount]) => (
              <div key={label} style={{ display: "flex" }}>
                <Box w="57%" style={bold}>
                  <span>
                    {label}&nbsp;&nbsp;{rate}
                  </span>
                </Box>
                <Box w="43%" center style={bold}>
                  {amount}
                </Box>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <Row>
        <Box w={LEFT} center style={{ ...bold, fontSize: 6 }}>
          {showTax ? "Tax Amount: RUPEES THREE HUNDRED SIXTY ONLY" : "RUPEES TWO THOUSAND ONLY"}
        </Box>
        <Box w={100 - LEFT - F} style={{ ...bold, fontSize: 9 }}>
          Total Amount
        </Box>
        <Box w={F} center style={{ ...bold, fontSize: 8 }}>
          {showTax ? "2,360.00" : "2,000.00"}
        </Box>
      </Row>
      <Row>
        <Box w={LEFT}>1) Goods once sold will not be taken back.</Box>
        <Box w={100 - LEFT} center style={{ ...accent, fontFamily: SERIF, fontWeight: 700, fontSize: 7.5, whiteSpace: "normal" }}>
          For {shopName}
        </Box>
      </Row>
      <Row>
        <Box w={LEFT} style={{ minHeight: 16 }} />
        <Box
          w={100 - LEFT}
          right
          style={{ ...accent, fontFamily: SERIF, fontWeight: 700, fontSize: 8.5, minHeight: 16, justifyContent: "flex-end", paddingRight: 8 }}
        >
          {signatoryLabel?.trim() || "Authorised Signatory"}
        </Box>
      </Row>
      <p className="mt-1.5 truncate text-center" style={{ fontSize: 7 }}>
        {footer || "Thank you for your business"}
      </p>
    </div>
  );
}
