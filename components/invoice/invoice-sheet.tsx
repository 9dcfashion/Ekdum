import type { CSSProperties, ReactNode } from "react";
import {
  SHEET_GRID as G,
  SHEET_LEFT,
  SHEET_RIGHT,
  buildInvoiceSheet,
  upiIdLines,
  type InvoiceSheet as Sheet,
  type SheetAlign,
  type SheetCharge,
} from "@/lib/invoices/sheet";
import type { InvoiceView } from "@/lib/invoices/view";

/**
 * The A4 bill in HTML: the same boxed grid as the PDF (lib/pdf/invoice-document.tsx),
 * filled from the same sheet model, so the customer sees the bill they know.
 * Server-safe (no hooks). It always looks like paper: white, navy text, black lines,
 * whatever the page theme. It needs about 720px; wrap it in a horizontal scroller on phones.
 */

const NAVY = "#1F3864";
const LINE = "1px solid #000";
const ROW = 22;
const SANS = 'Calibri, Carlito, "Helvetica Neue", Arial, sans-serif';
const SERIF = '"Times New Roman", Times, serif';

const pct = (part: number, whole = 100) => `${(part / whole) * 100}%`;

const rowStyle: CSSProperties = { display: "flex", borderLeft: LINE };
const innerRow: CSSProperties = { display: "flex" };
const bold: CSSProperties = { fontWeight: 700 };
const serif: CSSProperties = { fontFamily: SERIF, fontWeight: 700, fontSize: 16 };

function Cell({
  width,
  align = "left",
  height,
  grow,
  noBottom,
  style,
  role,
  children,
}: {
  width?: string;
  align?: SheetAlign;
  height?: number;
  grow?: number;
  noBottom?: boolean;
  style?: CSSProperties;
  role?: string;
  children?: ReactNode;
}) {
  return (
    <div
      role={role}
      style={{
        boxSizing: "border-box",
        width,
        flexShrink: width ? 0 : undefined,
        flexGrow: grow,
        minHeight: height ?? ROW,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "1px 5px",
        borderRight: LINE,
        borderBottom: noBottom ? undefined : LINE,
        textAlign: align,
        overflowWrap: "anywhere",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function ChargeRow({ charge }: { charge: SheetCharge | null }) {
  return (
    <div style={{ ...innerRow, flexGrow: 1 }}>
      <Cell width={pct(G.d + G.e, SHEET_RIGHT)} style={bold}>
        {charge ? (
          <div style={{ display: "flex" }}>
            <span style={{ width: "50%" }}>{charge.label}</span>
            <span>{charge.rate}</span>
          </div>
        ) : null}
      </Cell>
      <Cell width={pct(G.f, SHEET_RIGHT)} align="center" style={bold}>
        {charge?.amount ?? ""}
      </Cell>
    </div>
  );
}

function BankBlock({ sheet, brand, upiQr }: { sheet: Sheet; brand: string; upiQr: string | null }) {
  const bank = sheet.bank;
  const qr = bank?.upiId && upiQr ? upiQr : null;
  const lines = bank ? [...bank.lines] : [];
  if (bank?.upiId && !qr) lines.push(`UPI: ${bank.upiId}`);
  const spare = Math.max(sheet.charges.length - lines.length, 0);

  return (
    <div style={rowStyle}>
      <div style={{ width: pct(SHEET_LEFT), display: "flex", flexShrink: 0 }}>
        <div style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column" }}>
          {lines.length === 0 ? <Cell grow={1} /> : null}
          {lines.map((line, i) => (
            <Cell
              key={i}
              height={ROW * (i === 0 ? spare + 1 : 1)}
              grow={i === 0 ? spare + 1 : 1}
              style={{ ...bold, color: brand, lineHeight: `${ROW - 1}px`, paddingTop: 0, paddingBottom: 0 }}
            >
              {line}
            </Cell>
          ))}
        </div>
        {qr && bank?.upiId ? (
          <Cell style={{ width: 84, flexShrink: 0, alignItems: "center", padding: "3px 2px" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt={`UPI QR code to pay ${sheet.shopName}`} width={52} height={52} style={{ display: "block" }} />
            {upiIdLines(bank.upiId).map((line) => (
              <span key={line} style={{ fontSize: 9, lineHeight: 1.15, textAlign: "center", overflowWrap: "anywhere" }}>
                {line}
              </span>
            ))}
          </Cell>
        ) : null}
      </div>
      <div style={{ width: pct(SHEET_RIGHT), display: "flex", flexDirection: "column" }}>
        {sheet.charges.map((charge, i) => (
          <ChargeRow key={i} charge={charge} />
        ))}
      </div>
    </div>
  );
}

function SplitCells() {
  return (
    <>
      <Cell width={pct(G.d)} />
      <Cell width={pct(G.e)} />
      <Cell width={pct(G.f)} />
    </>
  );
}

export function InvoiceSheet({
  view,
  logoSrc,
  upiQr,
}: {
  view: InvoiceView;
  logoSrc: string | null;
  /** Data URL of the UPI QR code, printed inside the bank details. */
  upiQr: string | null;
}) {
  const sheet = buildInvoiceSheet(view);
  const brand = view.brandColor;
  const accent: CSSProperties = { color: brand };
  const rest = 100 - G.a;
  const bc = G.b + G.c;
  const de = G.d + G.e;
  const termRows = Math.max(3, sheet.terms.length);

  return (
    <div
      style={{
        position: "relative",
        background: "#fff",
        color: NAVY,
        fontFamily: SANS,
        fontSize: 13.5,
        lineHeight: 1.25,
        fontVariantNumeric: "tabular-nums",
        minWidth: 720,
        padding: 16,
      }}
    >
      {view.cancelled ? (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            color: "rgba(220, 38, 38, 0.16)",
            fontFamily: "Arial, sans-serif",
            fontWeight: 700,
            fontSize: 110,
            transform: "rotate(-30deg)",
          }}
        >
          CANCELLED
        </div>
      ) : null}

      {/* Logo | shop name over the tagline | document title */}
      <div style={{ ...rowStyle, borderTop: LINE }}>
        <Cell width={pct(G.a)} style={{ alignItems: "center", padding: 3 }}>
          {logoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoSrc} alt="" style={{ width: 54, height: 50, objectFit: "contain" }} />
          ) : null}
        </Cell>
        <div style={{ width: pct(100 - G.a - G.f), display: "flex", flexDirection: "column" }}>
          <Cell
            height={sheet.tagline ? 34 : 46}
            grow={sheet.tagline ? undefined : 1}
            align="center"
            style={{ ...accent, fontFamily: SERIF, fontWeight: 700, fontSize: 25, lineHeight: 1.1 }}
          >
            {sheet.shopName}
          </Cell>
          {sheet.tagline ? (
            <Cell height={20} grow={1} align="center" style={{ ...accent, ...bold, fontSize: 11.5 }}>
              {sheet.tagline}
            </Cell>
          ) : null}
        </div>
        <Cell width={pct(G.f)} align="center" style={{ padding: 3 }}>
          <span style={{ ...bold, fontSize: 14, letterSpacing: "0.03em" }}>{sheet.title}</span>
          <span style={{ fontSize: 9, color: "#44546A" }}>{sheet.copyLabel}</span>
        </Cell>
      </div>

      {sheet.addressRow ? (
        <div style={rowStyle}>
          <Cell width="100%" align="center" style={{ ...bold, fontSize: 11 }}>
            {sheet.addressRow}
          </Cell>
        </div>
      ) : null}

      {sheet.parties.map((row, i) => {
        const end = i === sheet.parties.length - 1;
        return (
          <div key={i} style={rowStyle}>
            <Cell width={pct(SHEET_LEFT)} noBottom={end}>
              {row.left?.text ?? ""}
            </Cell>
            <Cell width={pct(SHEET_RIGHT)} noBottom={end} style={row.right?.accent ? { ...bold, ...accent } : undefined}>
              {row.right?.text ?? ""}
            </Cell>
          </div>
        );
      })}

      {/* Items */}
      <div role="table" aria-label="Items">
        <div role="row" style={{ ...rowStyle, borderTop: LINE }}>
          {sheet.columns.map((column) => (
            <Cell key={column.key} role="columnheader" width={pct(column.width)} align="center" style={bold}>
              {column.label}
            </Cell>
          ))}
        </div>
        {sheet.rows.map((row) => (
          <div key={row.key} role="row" style={rowStyle}>
            {sheet.columns.map((column, i) => (
              <Cell key={column.key} role="cell" width={pct(column.width)} align={column.align}>
                {row.cells[i]}
              </Cell>
            ))}
          </div>
        ))}
      </div>

      <div style={rowStyle}>
        <Cell width={pct(SHEET_LEFT)} style={{ fontSize: 11.5 }}>
          {sheet.note ?? ""}
        </Cell>
        <Cell width={pct(de)} align="center" style={bold}>
          {sheet.subtotalLabel}
        </Cell>
        <Cell width={pct(G.f)} align="center" style={bold}>
          {sheet.subtotal}
        </Cell>
      </div>

      {sheet.charges.length > 0 ? <BankBlock sheet={sheet} brand={brand} upiQr={upiQr} /> : null}

      {/* Tax (or total) in words | Total Amount */}
      <div style={rowStyle}>
        <Cell width={pct(G.a)} align="center" style={{ ...bold, padding: 0 }}>
          {sheet.wordsLabel.map((line) => (
            <div key={line} style={{ flex: "1 1 0", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {line}
            </div>
          ))}
        </Cell>
        <div style={{ width: pct(rest), display: "flex", flexDirection: "column" }}>
          <div style={innerRow}>
            <Cell width={pct(bc, rest)} align="center" style={bold}>
              {sheet.words[0]}
            </Cell>
            <Cell width={pct(de, rest)} />
            <Cell width={pct(G.f, rest)} />
          </div>
          <div style={{ ...innerRow, flexGrow: 1 }}>
            <Cell width={pct(bc, rest)} align="center" style={bold}>
              {sheet.words[1]}
            </Cell>
            <Cell width={pct(de, rest)} style={{ ...bold, fontSize: 18 }}>
              Total Amount
            </Cell>
            <Cell width={pct(G.f, rest)} align="center" style={{ ...bold, fontSize: 16 }}>
              {sheet.grandTotal}
            </Cell>
          </div>
        </div>
      </div>

      <div style={rowStyle}>
        <Cell width={pct(SHEET_LEFT)} style={{ fontSize: 12 }}>
          {sheet.totalInWords ? (
            <span>
              Amount in words: <strong>{sheet.totalInWords}</strong>
            </span>
          ) : null}
        </Cell>
        {sheet.balanceDue ? (
          <>
            <Cell width={pct(de)} style={bold}>
              Balance Due
            </Cell>
            <Cell width={pct(G.f)} align="center" style={bold}>
              {sheet.balanceDue}
            </Cell>
          </>
        ) : (
          <SplitCells />
        )}
      </div>

      {Array.from({ length: termRows }, (_, i) => (
        <div key={i} style={rowStyle}>
          <Cell width={pct(SHEET_LEFT)}>{sheet.terms[i] ?? ""}</Cell>
          {i === 0 ? (
            <Cell width={pct(SHEET_RIGHT)} align="center" style={{ ...serif, ...accent }}>
              {sheet.signatoryFor}
            </Cell>
          ) : i === termRows - 1 ? (
            <Cell width={pct(SHEET_RIGHT)} align="right" style={{ ...serif, ...accent, paddingRight: 20 }}>
              {sheet.signatoryLabel}
            </Cell>
          ) : (
            <SplitCells />
          )}
        </div>
      ))}

      {sheet.cancelNote ? (
        <p style={{ margin: "8px 0 0", textAlign: "center", color: "#dc2626", fontSize: 12 }}>{sheet.cancelNote}</p>
      ) : null}
      {sheet.footer ? <p style={{ margin: "8px 0 0", textAlign: "center", fontSize: 12 }}>{sheet.footer}</p> : null}
    </div>
  );
}
