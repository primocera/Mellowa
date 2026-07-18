import type { MetadataRoute } from "next";

/** PWA manifest (Prompt 12) — installable, calm, mobile-first. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mellowa",
    short_name: "Mellowa",
    description: "A simple daily plan for food, energy, mood and habits.",
    start_url: "/today",
    display: "standalone",
    background_color: "#FAF7F2",
    theme_color: "#7C9A92",
    // Scalable SVG covers every size ("any"); a maskable entry lets Android
    // render a safe-area icon. A binary 192/512 PNG set is a pre-launch polish
    // item (see docs/seo-pwa.md) — the SVG installs correctly today.
    icons: [
      {
        src: "/mellowa-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/mellowa-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
    categories: ["health", "lifestyle", "productivity"],
    orientation: "portrait",
  };
}
