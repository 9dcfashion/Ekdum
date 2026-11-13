import { cn } from "@/lib/utils";

const PAPER = "#fffdf7";

const ITEMS = [
  { name: "Basmati Rice 5kg", qty: 1, amount: "630.00" },
  { name: "Tea 500g", qty: 2, amount: "315.00" },
  { name: "Detergent 1kg", qty: 1, amount: "236.00" },
];

function Rule() {
  return <div className="my-2 border-t border-dashed border-neutral-400" />;
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-2", bold && "text-sm font-bold")}>
      <span>{label}</span>
      <span className="tabular">{value}</span>
    </div>
  );
}

/** A QR-looking block. It is decoration only and does not encode anything. */
function MockQr() {
  const n = 21;
  const cells: Array<[number, number]> = [];
  const inFinder = (x: number, y: number) => (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (inFinder(x, y)) continue;
      if ((x * 7 + y * 13 + ((x * y) % 5) + ((x ^ y) % 3)) % 3 === 0) cells.push([x, y]);
    }
  }
  const finders: Array<[number, number]> = [
    [0, 0],
    [n - 7, 0],
    [0, n - 7],
  ];
  return (
    <svg viewBox={`0 0 ${n} ${n}`} className="size-14 shrink-0" shapeRendering="crispEdges" aria-hidden>
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="currentColor" />
      ))}
      {finders.map(([x, y]) => (
        <g key={`f-${x}-${y}`}>
          <rect x={x} y={y} width="7" height="7" fill="currentColor" />
          <rect x={x + 1} y={y + 1} width="5" height="5" fill={PAPER} />
          <rect x={x + 2} y={y + 2} width="3" height="3" fill="currentColor" />
        </g>
      ))}
    </svg>
  );
}

/** A hand-built 80mm thermal bill. All shop details are illustrative. */
export function Receipt({ className }: { className?: string }) {
  return (
    <div
      role="img"
      aria-label="Sample thermal GST bill: three items, CGST and SGST shown separately, total 1,181 rupees, paid by cash and UPI."
      className={cn("drop-shadow-xl", className)}
    >
      <div
        className="px-4 pt-5 pb-3 font-mono text-[11px] leading-[1.55] text-neutral-800"
        style={{ backgroundColor: PAPER }}
      >
        <div className="text-center">
          <p className="text-[13px] font-bold tracking-wide">SHARMA KIRANA STORE</p>
          <p>12, Main Bazaar, Jaipur 302003</p>
          <p>GSTIN 08ABCDE1234F1Z5</p>
        </div>
        <Rule />
        <div className="flex justify-between font-bold">
          <span>TAX INVOICE</span>
          <span>INV/26-27/0042</span>
        </div>
        <div className="flex justify-between">
          <span>12/11/2026 06:42 PM</span>
          <span>Cashier: Pooja</span>
        </div>
        <Rule />
        <div className="grid grid-cols-[minmax(0,1fr)_2rem_4rem] gap-x-1">
          <span className="font-bold">Item</span>
          <span className="text-right font-bold">Qty</span>
          <span className="text-right font-bold">Amount</span>
          {ITEMS.map((item) => (
            <div key={item.name} className="contents">
              <span className="truncate">{item.name}</span>
              <span className="tabular text-right">{item.qty}</span>
              <span className="tabular text-right">{item.amount}</span>
            </div>
          ))}
        </div>
        <Rule />
        <Row label="Taxable value" value="1,100.00" />
        <Row label="CGST" value="40.50" />
        <Row label="SGST" value="40.50" />
        <div className="mt-1">
          <Row label="TOTAL" value="₹1,181.00" bold />
        </div>
        <Rule />
        <Row label="Cash" value="181.00" />
        <Row label="UPI" value="1,000.00" />
        <Rule />
        <div className="flex items-center gap-3">
          <MockQr />
          <p>
            Scan to pay by UPI.
            <br />
            Bill link sent on WhatsApp.
          </p>
        </div>
        <Rule />
        <p className="text-center font-bold">Dhanyavaad! Phir aaiyega.</p>
      </div>
      {/* Torn, perforated edge */}
      <div
        aria-hidden
        className="h-2"
        style={{
          background: `conic-gradient(from -45deg at 50% 100%, ${PAPER} 90deg, transparent 0) 0 0 / 10px 8px repeat-x`,
        }}
      />
    </div>
  );
}
