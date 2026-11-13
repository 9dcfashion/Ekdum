import { ImageResponse } from "next/og";

export const alt = "EkDum: Poora dhandha, ekdum sorted. GST billing, POS and inventory for Indian shops.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INDIGO = "#4338CA";
const SAFFRON = "#F88B1C";

const RECEIPT_LINES = [
  ["Basmati Rice 5kg", "630.00"],
  ["Tea 500g x 2", "315.00"],
  ["Detergent 1kg", "236.00"],
];

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: INDIGO,
          color: "#ffffff",
          padding: 72,
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 660 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 72,
                height: 72,
                borderRadius: 18,
                background: "#ffffff",
                color: INDIGO,
                fontSize: 48,
                fontWeight: 900,
              }}
            >
              E
            </div>
            <div style={{ display: "flex", marginLeft: 20, fontSize: 56, fontWeight: 700 }}>
              <span>Ek</span>
              <span style={{ color: SAFFRON }}>Dum</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", flexDirection: "column", fontSize: 84, fontWeight: 800, lineHeight: 1.05 }}>
              <span>Poora dhandha,</span>
              <span style={{ color: SAFFRON }}>ekdum sorted.</span>
            </div>
            <div style={{ display: "flex", marginTop: 28, fontSize: 30, color: "rgba(255,255,255,0.85)" }}>
              GST billing, POS, inventory and dispatch for Indian shops.
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 24, color: "rgba(255,255,255,0.7)" }}>Powered by NineAgents</div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: 340,
            alignSelf: "center",
            background: "#FFFDF7",
            color: "#1f2937",
            padding: 28,
            fontSize: 20,
            transform: "rotate(4deg)",
            boxShadow: "0 30px 60px rgba(0,0,0,0.35)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "center", fontSize: 24, fontWeight: 700 }}>TAX INVOICE</div>
          <div style={{ display: "flex", justifyContent: "center", marginTop: 4, color: "#6b7280" }}>Sample bill</div>
          <div style={{ display: "flex", marginTop: 16, borderTop: "2px dashed #9ca3af" }} />
          {RECEIPT_LINES.map(([name, amount]) => (
            <div key={name} style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
              <span>{name}</span>
              <span>{amount}</span>
            </div>
          ))}
          <div style={{ display: "flex", marginTop: 16, borderTop: "2px dashed #9ca3af" }} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, color: "#6b7280" }}>
            <span>CGST + SGST</span>
            <span>81.00</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 28, fontWeight: 800 }}>
            <span>TOTAL</span>
            <span>Rs 1,181.00</span>
          </div>
          <div style={{ display: "flex", marginTop: 16, borderTop: "2px dashed #9ca3af" }} />
          <div style={{ display: "flex", justifyContent: "center", marginTop: 14, color: INDIGO, fontWeight: 700 }}>
            Dhanyavaad! Phir aaiyega.
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
