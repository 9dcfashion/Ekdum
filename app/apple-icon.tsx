import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** iOS rounds the corners itself, so the tile is full bleed. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#4338CA",
          color: "#ffffff",
          fontSize: 120,
          fontWeight: 900,
        }}
      >
        E
      </div>
    ),
    { ...size },
  );
}
