import type { InvoiceView } from "@/lib/invoices/view";
import { formatINR } from "@/lib/money";

const money = (paise: number) => formatINR(paise, { symbol: false });

function Row({ left, right, bold }: { left: React.ReactNode; right: React.ReactNode; bold?: boolean }) {
  return (
    <div className={`thermal-row${bold ? " thermal-bold" : ""}`}>
      <span>{left}</span>
      <span className="thermal-amount">{right}</span>
    </div>
  );
}

const Rule = () => <div className="thermal-rule" role="presentation" />;

/**
 * The thermal slip (80mm or 58mm). Plain markup styled by the print page's
 * <style> block: monospace, fixed width, no colours, nothing a receipt printer cannot draw.
 */
export function ThermalReceipt({
  view,
  logoSrc,
  upiQr,
  cashier,
}: {
  view: InvoiceView;
  logoSrc: string | null;
  upiQr: string | null;
  cashier: string | null;
}) {
  const t = view.totals;
  const received = view.payments.filter((p) => p.mode !== "credit");

  return (
    <article className="thermal" aria-label={`${view.title} ${view.number}`}>
      <header className="thermal-center">
        {logoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoSrc} alt="" className="thermal-logo" />
        ) : null}
        <p className="thermal-shop">{view.seller.name}</p>
        {/* Optional: a slip saved on the device before taglines existed has none. */}
        {view.tagline ? <p className="thermal-small thermal-bold">{view.tagline}</p> : null}
        {view.seller.legalName ? <p>{view.seller.legalName}</p> : null}
        {view.seller.addressLines.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
        {view.seller.state ? <p>{view.seller.state}</p> : null}
        {view.seller.phone ? <p>Ph: {view.seller.phone}</p> : null}
        {view.seller.gstin ? <p className="thermal-bold">GSTIN: {view.seller.gstin}</p> : null}
      </header>

      <Rule />
      <p className="thermal-center thermal-title">{view.title}</p>
      {view.cancelled ? <p className="thermal-center thermal-bold">*** CANCELLED ***</p> : null}
      <Row left={`No: ${view.number}`} right={view.date} />
      {cashier ? <p>Cashier: {cashier}</p> : null}
      {view.recipient ? (
        <div>
          {view.recipient.name ? <p>Customer: {view.recipient.name}</p> : null}
          {view.recipient.phone ? <p>Ph: {view.recipient.phone}</p> : null}
          {view.recipient.addressLines.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
          {view.recipient.state ? <p>State: {view.recipient.state}</p> : null}
          {view.recipient.gstin ? <p>GSTIN: {view.recipient.gstin}</p> : null}
        </div>
      ) : null}
      {view.placeOfSupply ? <p>Place of supply: {view.placeOfSupply}</p> : null}
      {view.reverseCharge === "Yes" ? <p>Reverse charge: Yes</p> : null}

      <Rule />
      <Row left="Item" right="Amount" bold />
      <Rule />
      {view.lines.map((line) => {
        const detail = [
          line.hsn ? `HSN ${line.hsn}` : null,
          line.gstRate ? `GST ${line.gstRate}` : null,
          line.cessPaise > 0 ? `Cess ${money(line.cessPaise)}` : null,
          line.discountPaise > 0 ? `Disc -${money(line.discountPaise)}` : null,
        ].filter(Boolean);
        return (
          <div key={line.lineNo} className="thermal-item">
            <p className="thermal-item-name">{line.description}</p>
            <Row left={`  ${line.quantity} ${line.unit} x ${money(line.unitPricePaise)}`} right={money(line.totalPaise)} />
            {detail.length > 0 ? <p className="thermal-small">{`  ${detail.join(" | ")}`}</p> : null}
          </div>
        );
      })}
      <Rule />

      {view.showTax ? (
        <Row left="Taxable value" right={money(t.taxablePaise)} />
      ) : (
        <Row left="Subtotal" right={money(t.subtotalPaise)} />
      )}
      {t.discountPaise > 0 ? <Row left={view.showTax ? "Discount given" : "Discount"} right={`-${money(t.discountPaise)}`} /> : null}
      {view.showTax && !view.interState ? <Row left="CGST" right={money(t.cgstPaise)} /> : null}
      {view.showTax && !view.interState ? <Row left="SGST" right={money(t.sgstPaise)} /> : null}
      {view.showTax && view.interState ? <Row left="IGST" right={money(t.igstPaise)} /> : null}
      {view.showCess ? <Row left="Cess" right={money(t.cessPaise)} /> : null}
      {t.roundOffPaise !== 0 ? (
        <Row left="Round off" right={`${t.roundOffPaise > 0 ? "+" : ""}${money(t.roundOffPaise)}`} />
      ) : null}
      <Rule />
      <div className="thermal-row thermal-total">
        <span>TOTAL</span>
        <span className="thermal-amount">{formatINR(t.totalPaise)}</span>
      </div>
      <Rule />

      {view.taxSummary.length > 0 ? (
        <div className="thermal-small">
          <p className="thermal-bold">GST summary</p>
          {view.taxSummary.map((row) => (
            <Row
              key={row.gstRate}
              left={`${row.rateLabel} on ${money(row.taxablePaise)}`}
              right={
                view.interState
                  ? `IGST ${money(row.igstPaise)}`
                  : `C ${money(row.cgstPaise)} S ${money(row.sgstPaise)}`
              }
            />
          ))}
          <Rule />
        </div>
      ) : null}

      {view.cancelled ? null : (
        <div>
          {received.map((p, i) => (
            <Row key={i} left={`${p.isCollection ? "Received" : "Paid"}: ${p.label}`} right={money(p.amountPaise)} />
          ))}
          {view.amountDuePaise > 0 ? <Row left="BALANCE DUE" right={formatINR(view.amountDuePaise)} bold /> : null}
        </div>
      )}

      <p className="thermal-small thermal-words">{view.amountInWords}</p>

      {view.upi && upiQr ? (
        <div className="thermal-center thermal-qr-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={upiQr} alt={`UPI QR code to pay ${formatINR(view.upi.amountPaise)}`} className="thermal-qr" />
          <p>{view.upi.due ? "Scan to pay" : "UPI"} {formatINR(view.upi.amountPaise)}</p>
          <p className="thermal-small">{view.upi.id}</p>
        </div>
      ) : null}

      {view.declaration ? <p className="thermal-small thermal-center thermal-declaration">{view.declaration}</p> : null}
      {view.cancelled && view.cancelReason ? <p className="thermal-small">Cancelled: {view.cancelReason}</p> : null}
      {view.terms.length > 0 ? (
        <div className="thermal-small thermal-terms">
          {view.terms.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      ) : null}
      <div className="thermal-sign">
        <p className="thermal-bold">{view.signatoryFor}</p>
        <p>{view.signatoryLabel}</p>
      </div>
      {view.footer ? <p className="thermal-center thermal-footer">{view.footer}</p> : null}
    </article>
  );
}

/** Print CSS for the slip. `paper` is the roll width in mm; the printable width is narrower. */
export function thermalCss(paper: 80 | 58): string {
  const printable = paper === 80 ? 72 : 48;
  const side = (paper - printable) / 2;
  const font = paper === 80 ? 12 : 10;
  return `
@page { size: ${paper}mm auto; margin: 0; }
.thermal {
  box-sizing: border-box;
  width: ${paper}mm;
  padding: 3mm ${side}mm 6mm;
  margin: 0 auto;
  background: #fff;
  color: #000;
  font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: ${font}px;
  line-height: 1.35;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.thermal p { margin: 0; }
.thermal-center { text-align: center; }
.thermal-bold { font-weight: 700; }
.thermal-small { font-size: ${font - 1.5}px; }
.thermal-shop { font-size: ${font + 4}px; font-weight: 700; line-height: 1.2; }
.thermal-title { font-size: ${font + 1}px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
.thermal-logo { display: block; margin: 0 auto 1.5mm; max-width: ${paper === 80 ? 30 : 22}mm; max-height: 18mm; object-fit: contain; filter: grayscale(1); }
.thermal-rule { border-top: 1px dashed #000; margin: 1.2mm 0; }
.thermal-row { display: flex; justify-content: space-between; gap: 2mm; white-space: pre-wrap; }
.thermal-amount { flex-shrink: 0; text-align: right; white-space: nowrap; }
.thermal-item { margin-bottom: 0.8mm; break-inside: avoid; }
.thermal-item-name { font-weight: 600; }
.thermal-item .thermal-small { white-space: pre-wrap; }
.thermal-total { font-size: ${font + 3}px; font-weight: 700; }
.thermal-words { margin-top: 1.2mm !important; }
.thermal-qr-block { margin-top: 2mm; break-inside: avoid; }
.thermal-qr { display: block; margin: 0 auto; width: ${paper === 80 ? 34 : 28}mm; height: ${paper === 80 ? 34 : 28}mm; image-rendering: pixelated; }
.thermal-declaration { margin-top: 2mm !important; }
.thermal-terms { margin-top: 2mm; }
.thermal-footer { margin-top: 2mm !important; }
.thermal-sign { margin-top: 3mm; text-align: right; break-inside: avoid; }
.thermal-sign p + p { margin-top: ${paper === 80 ? 9 : 7}mm !important; }
@media screen {
  .thermal { margin: 16px auto 32px; box-shadow: 0 1px 3px rgb(0 0 0 / 0.15); }
}
@media print {
  html, body { margin: 0 !important; padding: 0 !important; width: ${paper}mm; background: #fff !important; }
  .thermal { margin: 0; box-shadow: none; }
}
`;
}
