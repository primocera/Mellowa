import { ImageResponse } from "next/og";

/** Twitter card — same branded 1200×630 image as OpenGraph (Prompt 23). */
export const runtime = "edge";
export const alt = "Mellowa — a realistic wellbeing plan for the day you actually have";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function TwitterImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#FAF7F2",
          padding: "72px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 40, fontWeight: 600, color: "#6D8C7D" }}>
          Mellowa
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 68,
            fontWeight: 600,
            lineHeight: 1.15,
            color: "#1F2937",
            letterSpacing: "-0.02em",
          }}
        >
          A realistic wellbeing plan for the day you actually have.
        </div>
        <div style={{ display: "flex", fontSize: 32, color: "#6B7280" }}>
          No calorie targets · No streaks · General wellbeing, not medical care
        </div>
      </div>
    ),
    size
  );
}
