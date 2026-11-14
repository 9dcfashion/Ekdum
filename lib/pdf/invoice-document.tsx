import type { ReactNode } from "react";
import { Document, Font, Image, Page, StyleSheet, Text, View, type Styles } from "@react-pdf/renderer";
import {
  SHEET_GRID as G,
  SHEET_LEFT,
  SHEET_RIGHT,
  buildInvoiceSheet,
  sheetColumns,
  upiIdLines,
  type InvoiceSheet,
  type SheetAlign,
  type SheetCharge,
} from "@/lib/invoices/sheet";
import type { InvoiceView } from "@/lib/invoices/view";

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

/** The item-table columns of this bill (exported for tests). */
export const invoiceColumns = sheetColumns;

// The shopkeeper's sheet: dark navy text, black grid lines, accents in the brand colour.
const NAVY = "#1F3864";
const LINE = "#000000";
const BORDER = 0.8;
const ROW = 16;
const BOLD = "Helvetica-Bold";
const SERIF = "Times-Bold";
const FONT = 10;

// Wrap long words (addresses, bank names) whole, as a spreadsheet does, never "VA-SAI".
Font.registerHyphenationCallback((word) => [word]);

const s = StyleSheet.create({
  // Note: no page-level lineHeight. An inherited lineHeight makes react-pdf drop `render` text.
  page: { paddingTop: 34, paddingBottom: 44, paddingHorizontal: 36, fontFamily: "Helvetica", fontSize: FONT, color: NAVY },
  row: { flexDirection: "row", borderLeftWidth: BORDER, borderLeftColor: LINE },
  inner: { flexDirection: "row" },
  top: { borderTopWidth: BORDER, borderTopColor: LINE },
  cell: {
    minHeight: ROW,
    justifyContent: "center",
    paddingHorizontal: 3,
    paddingVertical: 1.5,
    borderRightWidth: BORDER,
    borderRightColor: LINE,
    borderBottomWidth: BORDER,
    borderBottomColor: LINE,
  },
  bold: { fontFamily: BOLD },
  name: { fontFamily: SERIF, fontSize: 17, textAlign: "center" },
  tagline: { fontFamily: BOLD, fontSize: 8, textAlign: "center" },
  address: { fontFamily: BOLD, fontSize: 7.6, textAlign: "center" },
  title: { fontFamily: BOLD, fontSize: 9.5, textAlign: "center", letterSpacing: 0.3 },
  copy: { fontSize: 5.8, textAlign: "center", marginTop: 1.5, color: "#44546A" },
  th: { fontFamily: BOLD, textAlign: "center" },
  words: { fontFamily: BOLD, textAlign: "center" },
  grandLabel: { fontFamily: BOLD, fontSize: 12.5 },
  grandValue: { fontFamily: BOLD, fontSize: 11, textAlign: "center" },
  serif: { fontFamily: SERIF, fontSize: 12 },
  logo: { width: 40, height: 36, objectFit: "contain" },
  qr: { width: 34, height: 34 },
  upiId: { fontSize: 5.6, textAlign: "center" },
  footerNote: { marginTop: 6, fontSize: 7.5, textAlign: "center" },
  cancelNote: { marginTop: 6, fontSize: 8, color: "#dc2626", textAlign: "center" },
  pageFooter: { position: "absolute", bottom: 20, left: 36, right: 36, fontSize: 7, color: "#52525b", textAlign: "right" },
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
});

type Style = Styles[string];

/** `part` as a percentage of `whole` (both in grid percent), for widths inside a nested block. */
const pct = (part: number, whole = 100) => `${(part / whole) * 100}%`;

function Cell({
  width,
  align = "left",
  height,
  grow,
  noBottom,
  style,
  textStyle,
  children,
}: {
  width?: string;
  align?: SheetAlign;
  height?: number;
  /** Share of any spare height in a stack of cells (true = 1). */
  grow?: boolean | number;
  noBottom?: boolean;
  style?: Style | Style[];
  textStyle?: Style | Style[];
  children?: ReactNode;
}) {
  const box: Style[] = [s.cell];
  if (width) box.push({ width });
  if (height) box.push({ minHeight: height });
  if (grow) box.push({ flexGrow: grow === true ? 1 : grow });
  if (noBottom) box.push({ borderBottomWidth: 0 });
  if (style) box.push(...(Array.isArray(style) ? style : [style]));
  const text: Style[] = [{ textAlign: align }];
  if (textStyle) text.push(...(Array.isArray(textStyle) ? textStyle : [textStyle]));
  return (
    <View style={box}>
      {typeof children === "string" || typeof children === "number" ? <Text style={text}>{children}</Text> : children}
    </View>
  );
}

function ItemRow({ sheet, index }: { sheet: InvoiceSheet; index: number }) {
  const row = sheet.rows[index];
  return (
    <View style={s.row} wrap={false}>
      {sheet.columns.map((column, i) => (
        <Cell key={column.key} width={pct(column.width)} align={column.align}>
          {row.cells[i]}
        </Cell>
      ))}
    </View>
  );
}

/** "Add SGST" | "1.5%" in the D-E box, the amount in F. An empty row when `charge` is null. */
function ChargeRow({ charge }: { charge: SheetCharge | null }) {
  const de = G.d + G.e;
  // Every row takes an equal share if the bank details on the left need more height.
  return (
    <View style={[s.inner, { flexGrow: 1 }]}>
      <Cell width={pct(de, SHEET_RIGHT)}>
        {charge ? (
          <View style={{ flexDirection: "row" }}>
            <Text style={[s.bold, { width: "50%" }]}>{charge.label}</Text>
            <Text style={s.bold}>{charge.rate}</Text>
          </View>
        ) : null}
      </Cell>
      <Cell width={pct(G.f, SHEET_RIGHT)} align="center" textStyle={s.bold}>
        {charge?.amount ?? ""}
      </Cell>
    </View>
  );
}

/**
 * Bank details on the left, as tall as the tax rows on the right. The bank lines sit in their
 * own rows like the original (the first one taking any spare height); the UPI QR, when there is
 * one, fills a box at the right edge of the block with the UPI ID under it.
 */
function BankBlock({ sheet, brand, upiQr }: { sheet: InvoiceSheet; brand: string; upiQr: string | null }) {
  const rows = sheet.charges.length;
  const bank = sheet.bank;
  const qr = bank?.upiId && upiQr ? upiQr : null;
  const lines = bank ? [...bank.lines] : [];
  // No QR image (it could not be made): print the UPI ID as a bank line instead.
  if (bank?.upiId && !qr) lines.push(`UPI: ${bank.upiId}`);
  const spare = Math.max(rows - lines.length, 0);
  // Room for the bank lines is tighter beside the QR.
  const bankFont = qr ? 9.5 : FONT;

  return (
    <View style={s.row}>
      <View style={{ width: pct(SHEET_LEFT), flexDirection: "row" }}>
        <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0 }}>
          {lines.length === 0 ? <Cell grow /> : null}
          {lines.map((line, i) => (
            <Cell
              key={i}
              height={ROW * (i === 0 ? spare + 1 : 1)}
              grow={i === 0 ? spare + 1 : 1}
              style={{ paddingVertical: 0 }}
              // One wrapped line per row of the block, like text wrapping in a merged spreadsheet cell.
              textStyle={[s.bold, { color: brand, fontSize: bankFont, lineHeight: `${ROW - BORDER}pt` }]}
            >
              {line}
            </Cell>
          ))}
        </View>
        {qr && bank?.upiId ? (
          <Cell style={{ width: 50, alignItems: "center", paddingVertical: 1.5, paddingHorizontal: 1 }}>
            {/* react-pdf images have no alt text. */}
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image src={qr} style={s.qr} />
            {upiIdLines(bank.upiId).map((line, i) => (
              <Text key={i} style={s.upiId}>
                {line}
              </Text>
            ))}
          </Cell>
        ) : null}
      </View>
      <View style={{ width: pct(SHEET_RIGHT) }}>
        {sheet.charges.map((charge, i) => (
          <ChargeRow key={i} charge={charge} />
        ))}
      </View>
    </View>
  );
}

/** Two stacked lines in a label box that spans two rows ("Tax" / "Amount"). */
function SpanLabel({ lines, width }: { lines: [string, string]; width: string }) {
  return (
    <Cell width={width} style={{ paddingVertical: 0 }}>
      {lines.map((line, i) => (
        <View key={i} style={{ flexGrow: 1, justifyContent: "center" }}>
          <Text style={[s.bold, { textAlign: "center" }]}>{line}</Text>
        </View>
      ))}
    </Cell>
  );
}

/** The empty split row of the sheet: D | E | F. */
function SplitCells({ grow }: { grow?: boolean }) {
  return (
    <>
      <Cell width={pct(G.d)} grow={grow} />
      <Cell width={pct(G.e)} grow={grow} />
      <Cell width={pct(G.f)} grow={grow} />
    </>
  );
}

/** Words, grand total, balance due, terms and signature: the bottom of the sheet. */
function Closing({ sheet, brand }: { sheet: InvoiceSheet; brand: string }) {
  const rest = 100 - G.a;
  const bc = G.b + G.c;
  const de = G.d + G.e;
  const termRows = Math.max(3, sheet.terms.length);

  return (
    <>
      {/* "Tax Amount" + tax in words | "Total Amount" + grand total */}
      <View style={s.row}>
        <SpanLabel lines={sheet.wordsLabel} width={pct(G.a)} />
        <View style={{ width: pct(rest) }}>
          <View style={s.inner}>
            <Cell width={pct(bc, rest)} textStyle={s.words}>
              {sheet.words[0]}
            </Cell>
            <Cell width={pct(de, rest)} />
            <Cell width={pct(G.f, rest)} />
          </View>
          <View style={[s.inner, { flexGrow: 1 }]}>
            <Cell width={pct(bc, rest)} textStyle={s.words}>
              {sheet.words[1]}
            </Cell>
            <Cell width={pct(de, rest)} textStyle={s.grandLabel}>
              Total Amount
            </Cell>
            <Cell width={pct(G.f, rest)} textStyle={s.grandValue}>
              {sheet.grandTotal}
            </Cell>
          </View>
        </View>
      </View>

      {/* The bill total in words (tax invoices) | balance due */}
      <View style={s.row}>
        <Cell width={pct(SHEET_LEFT)}>
          {sheet.totalInWords ? (
            <Text style={{ fontSize: 8.5 }}>
              Amount in words: <Text style={s.bold}>{sheet.totalInWords}</Text>
            </Text>
          ) : null}
        </Cell>
        {sheet.balanceDue ? (
          <>
            <Cell width={pct(de)} textStyle={s.bold}>
              Balance Due
            </Cell>
            <Cell width={pct(G.f)} align="center" textStyle={s.bold}>
              {sheet.balanceDue}
            </Cell>
          </>
        ) : (
          <SplitCells />
        )}
      </View>

      {/* Terms | For {shop}, a blank row to sign in, the signatory title */}
      {Array.from({ length: termRows }, (_, i) => (
        <View key={i} style={s.row}>
          <Cell width={pct(SHEET_LEFT)}>{sheet.terms[i] ?? ""}</Cell>
          {i === 0 ? (
            <Cell width={pct(SHEET_RIGHT)} align="center" textStyle={[s.serif, { color: brand }]}>
              {sheet.signatoryFor}
            </Cell>
          ) : i === termRows - 1 ? (
            <Cell width={pct(SHEET_RIGHT)} align="right" textStyle={[s.serif, { color: brand, paddingRight: 14 }]}>
              {sheet.signatoryLabel}
            </Cell>
          ) : (
            <SplitCells />
          )}
        </View>
      ))}
    </>
  );
}

/** The single A4 template: the shopkeeper's boxed bill, filled from the invoice view. */
export function InvoiceDocument({ view, logo, upiQr }: InvoiceDocumentProps) {
  const brand = view.brandColor;
  const sheet = buildInvoiceSheet(view);
  const accent = { color: brand };
  const last = sheet.rows.length - 1;
  const headerRight = 100 - G.a - G.f;

  return (
    <Document
      title={`${view.title} ${view.number}`}
      author={view.seller.name}
      subject={`${view.title} ${view.number} dated ${view.date}`}
      creator="EkDum"
      producer="EkDum"
    >
      <Page size="A4" style={s.page}>
        {view.cancelled ? (
          <Text style={s.watermark} fixed>
            CANCELLED
          </Text>
        ) : null}
        <Text
          style={s.pageFooter}
          render={({ pageNumber, totalPages }) =>
            totalPages > 1 ? `${view.title} ${view.number}  |  Page ${pageNumber} of ${totalPages}` : ""
          }
          fixed
        />

        {/* Logo | shop name over the tagline | document title */}
        <View style={[s.row, s.top]}>
          <Cell width={pct(G.a)} style={{ alignItems: "center", paddingHorizontal: 2 }}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            {logo ? <Image src={logo} style={s.logo} /> : null}
          </Cell>
          <View style={{ width: pct(headerRight) }}>
            <Cell height={sheet.tagline ? 24 : 34} grow={!sheet.tagline} textStyle={[s.name, accent]}>
              {sheet.shopName}
            </Cell>
            {sheet.tagline ? (
              <Cell height={14} grow textStyle={[s.tagline, accent]}>
                {sheet.tagline}
              </Cell>
            ) : null}
          </View>
          <Cell width={pct(G.f)} style={{ paddingHorizontal: 2 }}>
            <Text style={s.title}>{sheet.title}</Text>
            <Text style={s.copy}>{sheet.copyLabel}</Text>
          </Cell>
        </View>

        {sheet.addressRow ? (
          <View style={s.row}>
            <Cell width="100%" textStyle={s.address}>
              {sheet.addressRow}
            </Cell>
          </View>
        ) : null}

        {/* Buyer | invoice details. The last row has no bottom line: the table header draws it. */}
        {sheet.parties.map((row, i) => {
          const end = i === sheet.parties.length - 1;
          return (
            <View key={i} style={s.row}>
              <Cell width={pct(SHEET_LEFT)} noBottom={end}>
                {row.left?.text ?? ""}
              </Cell>
              <Cell
                width={pct(SHEET_RIGHT)}
                noBottom={end}
                textStyle={row.right?.accent ? [s.bold, accent] : undefined}
              >
                {row.right?.text ?? ""}
              </Cell>
            </View>
          );
        })}

        {/* The table header is `fixed`, so it repeats on every page the table reaches. */}
        <View style={[s.row, s.top]} fixed>
          {sheet.columns.map((column) => (
            <Cell key={column.key} width={pct(column.width)} textStyle={s.th}>
              {column.label}
            </Cell>
          ))}
        </View>
        {sheet.rows.slice(0, Math.max(last, 0)).map((row, index) => (
          <ItemRow key={row.key} sheet={sheet} index={index} />
        ))}

        {/* The last line travels with the totals, so the totals never sit alone on a page. */}
        <View wrap={false}>
          {last >= 0 ? <ItemRow sheet={sheet} index={last} /> : null}

          <View style={s.row}>
            <Cell width={pct(SHEET_LEFT)} textStyle={{ fontSize: 7.5 }}>
              {sheet.note ?? ""}
            </Cell>
            <Cell width={pct(G.d + G.e)} align="center" textStyle={s.bold}>
              {sheet.subtotalLabel}
            </Cell>
            <Cell width={pct(G.f)} align="center" textStyle={s.bold}>
              {sheet.subtotal}
            </Cell>
          </View>

          {sheet.charges.length > 0 ? <BankBlock sheet={sheet} brand={brand} upiQr={upiQr ?? null} /> : null}

          <Closing sheet={sheet} brand={brand} />

          {sheet.cancelNote ? <Text style={s.cancelNote}>{sheet.cancelNote}</Text> : null}
          {sheet.footer ? <Text style={s.footerNote}>{sheet.footer}</Text> : null}
        </View>
      </Page>
    </Document>
  );
}
