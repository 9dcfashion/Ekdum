import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { InvoiceView, InvoiceViewLine } from "@/lib/invoices/view";
import { pdfMoney, pdfRupees, pdfSigned } from "./format";

/** A PNG or JPEG the PDF engine can embed. */
export interface PdfImage {
  data: Buffer;
  format: "png" | "jpg";
}

export interface InvoiceDocumentProps {
  /** Already passed through pdfSafeDeep(): every string is drawable in Helvetica. */
  view: InvoiceView;
  logo?: PdfImage | null;
  /** PNG data URL of the UPI QR code. */
  upiQr?: string | null;
}

const INK = "#18181b";
const MUTED = "#52525b";
const RULE = "#d4d4d8";
const SOFT = "#f4f4f5";
const BOLD = "Helvetica-Bold";

const s = StyleSheet.create({
  page: {
    paddingTop: 34,
    paddingBottom: 46,
    paddingHorizontal: 30,
    fontFamily: "Helvetica",
    fontSize: 8.5,
    color: INK,
  },
  brandBar: { position: "absolute", top: 0, left: 0, right: 0, height: 7 },
  pageFooter: { position: "absolute", bottom: 20, left: 30, right: 30, fontSize: 7, color: MUTED },
  watermark: {
    position: "absolute",
    top: 360,
    left: 40,
    width: 520,
    textAlign: "center",
    fontSize: 84,
    fontFamily: BOLD,
    color: "#dc2626",
    opacity: 0.16,
    transform: "rotate(-35deg)",
  },
  bold: { fontFamily: BOLD },
  muted: { color: MUTED },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  sellerRow: { flexDirection: "row", flexGrow: 1, flexShrink: 1, flexBasis: 0, paddingRight: 14 },
  logo: { width: 52, height: 52, objectFit: "contain", marginRight: 10 },
  sellerName: { fontSize: 15, fontFamily: BOLD, lineHeight: 1.2, marginBottom: 2 },
  titleBox: { width: 190, alignItems: "flex-end" },
  title: { fontSize: 17, fontFamily: BOLD, lineHeight: 1.15, textTransform: "uppercase" },
  cancelledTag: {
    marginTop: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: "#dc2626",
    color: "#dc2626",
    fontFamily: BOLD,
    fontSize: 8,
  },
  metaRow: { flexDirection: "row", marginTop: 12, borderWidth: 0.75, borderColor: RULE },
  metaBox: { flexGrow: 1, flexShrink: 1, flexBasis: 0, padding: 8 },
  metaBoxRight: { borderLeftWidth: 0.75, borderLeftColor: RULE },
  boxLabel: { fontSize: 7, fontFamily: BOLD, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 },
  kv: { flexDirection: "row", marginBottom: 1.5 },
  kvKey: { width: 84, color: MUTED },
  kvValue: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  caption: { marginTop: 10, marginBottom: 3, fontSize: 7, color: MUTED, textAlign: "right" },
  th: {
    flexDirection: "row",
    alignItems: "center",
    color: "#ffffff",
    fontFamily: BOLD,
    fontSize: 7.2,
    paddingVertical: 4,
  },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: RULE,
    borderLeftWidth: 0.5,
    borderLeftColor: RULE,
    borderRightWidth: 0.5,
    borderRightColor: RULE,
    paddingVertical: 3.5,
    fontSize: 7.8,
  },
  cell: { paddingHorizontal: 3 },
  closing: { marginTop: 10, flexDirection: "row" },
  closingLeft: { flexGrow: 1, flexShrink: 1, flexBasis: 0, paddingRight: 14 },
  totalsBox: { width: 210 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2, paddingHorizontal: 6 },
  grandTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
    paddingHorizontal: 6,
    marginTop: 3,
    color: "#ffffff",
    fontFamily: BOLD,
    fontSize: 10.5,
  },
  wordsBox: { backgroundColor: SOFT, padding: 6, marginBottom: 8 },
  miniTh: { flexDirection: "row", backgroundColor: SOFT, fontFamily: BOLD, fontSize: 7, paddingVertical: 3 },
  miniTr: { flexDirection: "row", fontSize: 7.5, paddingVertical: 2.5, borderBottomWidth: 0.5, borderBottomColor: RULE },
  payRow: { flexDirection: "row", marginTop: 12 },
  payBox: { flexGrow: 1, flexShrink: 1, flexBasis: 0, paddingRight: 12 },
  qrBox: { width: 104, alignItems: "center" },
  qr: { width: 84, height: 84 },
  signBox: { width: 170, alignItems: "flex-end", justifyContent: "space-between" },
  signLine: { marginTop: 40, borderTopWidth: 0.75, borderTopColor: INK, paddingTop: 3, width: 150, textAlign: "center" },
  terms: { marginTop: 12 },
  declaration: { marginTop: 10, padding: 6, borderWidth: 0.75, borderColor: RULE, fontFamily: BOLD, fontSize: 8 },
  footerNote: { marginTop: 12, textAlign: "center", color: MUTED },
});

type Align = "left" | "right" | "center";

interface Column {
  key: string;
  label: string;
  /** Fixed width in points; the description column grows instead. */
  width?: number;
  align: Align;
  value: (line: InvoiceViewLine, index: number) => string;
}

/** The line-item columns for this document: tax columns only on a tax invoice, IGST or CGST+SGST by supply. */
export function invoiceColumns(view: InvoiceView): Column[] {
  const columns: Column[] = [
    { key: "no", label: "#", width: 18, align: "center", value: (_l, i) => String(i + 1) },
    { key: "description", label: "Description of goods / services", align: "left", value: (l) => l.description },
  ];
  if (view.showHsn) columns.push({ key: "hsn", label: "HSN/SAC", width: 40, align: "left", value: (l) => l.hsn });
  columns.push(
    { key: "qty", label: "Qty", width: 34, align: "right", value: (l) => l.quantity },
    { key: "unit", label: "Unit", width: 26, align: "left", value: (l) => l.unit },
    { key: "rate", label: "Rate", width: 48, align: "right", value: (l) => pdfMoney(l.unitPricePaise) },
    { key: "discount", label: "Disc.", width: 38, align: "right", value: (l) => pdfMoney(l.discountPaise) },
  );
  if (view.showTax) {
    columns.push(
      { key: "taxable", label: "Taxable value", width: 52, align: "right", value: (l) => pdfMoney(l.taxablePaise) },
      { key: "gst", label: "GST%", width: 30, align: "right", value: (l) => l.gstRate },
    );
    if (view.interState) {
      columns.push({ key: "igst", label: "IGST", width: 46, align: "right", value: (l) => pdfMoney(l.igstPaise) });
    } else {
      columns.push(
        { key: "cgst", label: "CGST", width: 40, align: "right", value: (l) => pdfMoney(l.cgstPaise) },
        { key: "sgst", label: "SGST", width: 40, align: "right", value: (l) => pdfMoney(l.sgstPaise) },
      );
    }
    if (view.showCess) {
      columns.push({ key: "cess", label: "Cess", width: 36, align: "right", value: (l) => pdfMoney(l.cessPaise) });
    }
  }
  columns.push({ key: "total", label: "Amount", width: 56, align: "right", value: (l) => pdfMoney(l.totalPaise) });
  return columns;
}

function cellStyle(column: Column) {
  return [
    s.cell,
    column.width ? { width: column.width } : { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
    { textAlign: column.align },
  ];
}

function LineRow({ line, index, columns }: { line: InvoiceViewLine; index: number; columns: Column[] }) {
  return (
    <View style={s.tr} wrap={false}>
      {columns.map((column) => (
        <Text key={column.key} style={cellStyle(column)}>
          {column.value(line, index)}
        </Text>
      ))}
    </View>
  );
}

function KeyValue({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View style={s.kv}>
      <Text style={s.kvKey}>{label}</Text>
      <Text style={s.kvValue}>{value}</Text>
    </View>
  );
}

function TotalRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={s.totalRow}>
      <Text style={bold ? s.bold : undefined}>{label}</Text>
      <Text style={bold ? s.bold : undefined}>{value}</Text>
    </View>
  );
}

function TaxSummary({ view }: { view: InvoiceView }) {
  if (!view.showTax || view.taxSummary.length === 0) return null;
  const w = { flexGrow: 1, flexShrink: 1, flexBasis: 0, textAlign: "right" as const, paddingHorizontal: 3 };
  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={[s.boxLabel, { color: view.brandColor }]}>Tax summary</Text>
      <View style={s.miniTh}>
        <Text style={{ width: 44, paddingHorizontal: 3 }}>GST rate</Text>
        <Text style={w}>Taxable</Text>
        {view.interState ? <Text style={w}>IGST</Text> : <Text style={w}>CGST</Text>}
        {view.interState ? null : <Text style={w}>SGST</Text>}
        {view.showCess ? <Text style={w}>Cess</Text> : null}
        <Text style={w}>Total tax</Text>
      </View>
      {view.taxSummary.map((row) => (
        <View key={row.gstRate} style={s.miniTr}>
          <Text style={{ width: 44, paddingHorizontal: 3 }}>{row.rateLabel}</Text>
          <Text style={w}>{pdfMoney(row.taxablePaise)}</Text>
          {view.interState ? <Text style={w}>{pdfMoney(row.igstPaise)}</Text> : <Text style={w}>{pdfMoney(row.cgstPaise)}</Text>}
          {view.interState ? null : <Text style={w}>{pdfMoney(row.sgstPaise)}</Text>}
          {view.showCess ? <Text style={w}>{pdfMoney(row.cessPaise)}</Text> : null}
          <Text style={w}>{pdfMoney(row.cgstPaise + row.sgstPaise + row.igstPaise + row.cessPaise)}</Text>
        </View>
      ))}
    </View>
  );
}

/** The single A4 master template. Driven entirely by the invoice view (business + outlet settings). */
export function InvoiceDocument({ view, logo, upiQr }: InvoiceDocumentProps) {
  const brand = view.brandColor;
  const columns = invoiceColumns(view);
  const bodyLines = view.lines.slice(0, -1);
  const lastLine = view.lines.length > 0 ? view.lines[view.lines.length - 1] : null;
  const t = view.totals;
  const received = view.payments.filter((p) => p.mode !== "credit");

  return (
    <Document
      title={`${view.title} ${view.number}`}
      author={view.seller.name}
      subject={`${view.title} ${view.number} dated ${view.date}`}
      creator="EkDum"
      producer="EkDum"
    >
      <Page size="A4" style={s.page}>
        <View style={[s.brandBar, { backgroundColor: brand }]} fixed />
        {view.cancelled ? (
          <Text style={s.watermark} fixed>
            CANCELLED
          </Text>
        ) : null}

        {/* Note: no page-level lineHeight. An inherited lineHeight makes react-pdf drop `render` text. */}
        <Text style={s.pageFooter} fixed>
          {view.title} {view.number} | {view.seller.name}
        </Text>
        <Text
          style={[s.pageFooter, { textAlign: "right" }]}
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          fixed
        />

        {/* Supplier and document title */}
        <View style={s.header}>
          <View style={s.sellerRow}>
            {/* react-pdf images have no alt text. */}
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            {logo ? <Image src={logo} style={s.logo} /> : null}
            <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0 }}>
              <Text style={s.sellerName}>{view.seller.name}</Text>
              {view.seller.legalName ? <Text style={s.muted}>{view.seller.legalName}</Text> : null}
              {view.seller.addressLines.map((line, i) => (
                <Text key={i}>{line}</Text>
              ))}
              {view.seller.state ? <Text>State: {view.seller.state}</Text> : null}
              {view.seller.phone || view.seller.email ? (
                <Text>
                  {[view.seller.phone ? `Phone: ${view.seller.phone}` : null, view.seller.email ? `Email: ${view.seller.email}` : null]
                    .filter(Boolean)
                    .join("   ")}
                </Text>
              ) : null}
              {view.seller.gstin ? <Text style={s.bold}>GSTIN: {view.seller.gstin}</Text> : null}
            </View>
          </View>
          <View style={s.titleBox}>
            <Text style={[s.title, { color: brand }]}>{view.title}</Text>
            <Text style={{ fontSize: 10.5, fontFamily: BOLD, marginTop: 3 }}>{view.number}</Text>
            <Text style={[s.muted, { marginTop: 2 }]}>Date: {view.date}</Text>
            {view.cancelled ? <Text style={s.cancelledTag}>CANCELLED</Text> : null}
          </View>
        </View>

        {/* Recipient and document details */}
        <View style={s.metaRow}>
          <View style={s.metaBox}>
            <Text style={[s.boxLabel, { color: brand }]}>Bill to</Text>
            {view.recipient ? (
              <View>
                {view.recipient.name ? <Text style={[s.bold, { fontSize: 9.5 }]}>{view.recipient.name}</Text> : null}
                {view.recipient.addressLines.map((line, i) => (
                  <Text key={i}>{line}</Text>
                ))}
                {view.recipient.state ? <Text>State: {view.recipient.state}</Text> : null}
                {view.recipient.phone ? <Text>Phone: {view.recipient.phone}</Text> : null}
                {view.recipient.email ? <Text>Email: {view.recipient.email}</Text> : null}
                {view.recipient.gstin ? <Text style={s.bold}>GSTIN: {view.recipient.gstin}</Text> : null}
              </View>
            ) : (
              <Text>Cash sale</Text>
            )}
          </View>
          <View style={[s.metaBox, s.metaBoxRight]}>
            <Text style={[s.boxLabel, { color: brand }]}>Details</Text>
            <KeyValue label={view.showGstFields ? "Invoice no." : "Bill no."} value={view.number} />
            <KeyValue label="Date" value={view.date} />
            <KeyValue label="Place of supply" value={view.placeOfSupply} />
            <KeyValue label="Reverse charge" value={view.reverseCharge} />
            <KeyValue label="Issued from" value={view.seller.outletName} />
          </View>
        </View>

        {/* Line items. The header row is `fixed`, so it repeats on every page the table reaches. */}
        <Text style={s.caption}>All amounts are in Indian Rupees (INR)</Text>
        <View style={[s.th, { backgroundColor: brand }]} fixed>
          {columns.map((column) => (
            <Text key={column.key} style={cellStyle(column)}>
              {column.label}
            </Text>
          ))}
        </View>
        {bodyLines.map((line, index) => (
          <LineRow key={line.lineNo} line={line} index={index} columns={columns} />
        ))}

        {/* The last line travels with the totals, so totals never sit alone on a page. */}
        <View wrap={false}>
          {lastLine ? <LineRow line={lastLine} index={view.lines.length - 1} columns={columns} /> : null}

          <View style={s.closing}>
            <View style={s.closingLeft}>
              <View style={s.wordsBox}>
                <Text style={[s.boxLabel, { color: brand }]}>Amount in words</Text>
                <Text style={s.bold}>{view.amountInWords}</Text>
              </View>
              <TaxSummary view={view} />
              {received.length > 0 ? (
                <View>
                  <Text style={[s.boxLabel, { color: brand }]}>Payments received</Text>
                  {received.map((p, i) => (
                    <Text key={i}>
                      {p.date} · {p.label}
                      {p.reference ? ` (${p.reference})` : ""} · Rs. {pdfMoney(p.amountPaise)}
                    </Text>
                  ))}
                </View>
              ) : null}
              {view.notes ? (
                <View style={{ marginTop: 6 }}>
                  <Text style={[s.boxLabel, { color: brand }]}>Notes</Text>
                  <Text>{view.notes}</Text>
                </View>
              ) : null}
            </View>

            <View style={s.totalsBox}>
              {view.showTax ? null : <TotalRow label="Subtotal" value={pdfMoney(t.subtotalPaise)} />}
              {t.discountPaise > 0 ? <TotalRow label="Discount" value={`-${pdfMoney(t.discountPaise)}`} /> : null}
              {view.showTax ? <TotalRow label="Taxable value" value={pdfMoney(t.taxablePaise)} /> : null}
              {view.showTax && !view.interState ? <TotalRow label="CGST" value={pdfMoney(t.cgstPaise)} /> : null}
              {view.showTax && !view.interState ? <TotalRow label="SGST" value={pdfMoney(t.sgstPaise)} /> : null}
              {view.showTax && view.interState ? <TotalRow label="IGST" value={pdfMoney(t.igstPaise)} /> : null}
              {view.showTax && view.showCess ? <TotalRow label="Cess" value={pdfMoney(t.cessPaise)} /> : null}
              <TotalRow label="Round off" value={pdfSigned(t.roundOffPaise)} />
              <View style={[s.grandTotal, { backgroundColor: brand }]}>
                <Text>Total (INR)</Text>
                <Text>{pdfRupees(t.totalPaise)}</Text>
              </View>
              {view.cancelled ? null : (
                <View style={{ marginTop: 3 }}>
                  <TotalRow label="Paid" value={pdfMoney(view.paidPaise)} />
                  <TotalRow label="Balance due" value={pdfMoney(view.amountDuePaise)} bold={view.amountDuePaise > 0} />
                </View>
              )}
            </View>
          </View>

          <View style={s.payRow}>
            <View style={s.payBox}>
              {view.bank ? (
                <View>
                  <Text style={[s.boxLabel, { color: brand }]}>Bank details</Text>
                  <KeyValue label="Bank" value={view.bank.bankName} />
                  <KeyValue label="Account name" value={view.bank.accountName} />
                  <KeyValue label="Account no." value={view.bank.accountNumber} />
                  <KeyValue label="IFSC" value={view.bank.ifsc} />
                </View>
              ) : null}
              {view.upi ? <KeyValue label="UPI ID" value={view.upi.id} /> : null}
            </View>
            {view.upi && upiQr ? (
              <View style={s.qrBox}>
                {/* eslint-disable-next-line jsx-a11y/alt-text */}
                <Image src={upiQr} style={s.qr} />
                <Text style={{ fontSize: 7, textAlign: "center", marginTop: 2 }}>
                  {view.upi.due ? "Scan to pay" : "UPI"} {pdfRupees(view.upi.amountPaise)}
                </Text>
              </View>
            ) : null}
            <View style={s.signBox}>
              <Text style={s.bold}>{view.signatoryFor}</Text>
              <Text style={s.signLine}>{view.signatoryLabel}</Text>
            </View>
          </View>
        </View>

        {view.declaration ? <Text style={s.declaration}>{view.declaration}</Text> : null}

        {view.terms.length > 0 ? (
          <View style={s.terms}>
            <Text style={[s.boxLabel, { color: brand }]}>Terms and conditions</Text>
            {view.terms.map((line, i) => (
              <Text key={i} style={{ fontSize: 7.8 }}>
                {line}
              </Text>
            ))}
          </View>
        ) : null}

        {view.cancelled && view.cancelReason ? (
          <Text style={{ marginTop: 10, color: "#dc2626" }}>This bill was cancelled. Reason: {view.cancelReason}</Text>
        ) : null}

        {view.footer ? <Text style={s.footerNote}>{view.footer}</Text> : null}
      </Page>
    </Document>
  );
}
