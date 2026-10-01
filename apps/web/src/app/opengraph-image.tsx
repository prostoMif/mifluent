import { ImageResponse } from "next/og";

export const alt = "Mifluent — know when a competitor changes prices, the next morning";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The link preview: the promise, and one price change the way the brief shows it. */
export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        background: "linear-gradient(160deg, #eef2fe, #ffffff 60%)",
        color: "#111317",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ fontSize: 30, fontWeight: 700, color: "#2f5bea" }}>Mifluent</div>
      <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1, letterSpacing: -1 }}>
        Know when a competitor changes prices — the next morning.
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 20, fontSize: 40 }}>
        <span style={{ color: "#5b616e", textDecoration: "line-through" }}>$29</span>
        <span style={{ color: "#2f5bea" }}>→</span>
        <span style={{ fontWeight: 700 }}>$39 / seat</span>
        <span style={{ fontSize: 26, color: "#5b616e" }}>each line quoted from the source</span>
      </div>
    </div>,
    size,
  );
}
