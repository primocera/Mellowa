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
    // MW-V9-09: real binary PNG icons (generated from the brand SVG, no brand
    // change) at the required 192/512 sizes, plus a maskable 512 with ~20%
    // safe-area padding so Android's mask never clips the mark. The scalable
    // SVG is kept as an "any" entry for crisp rendering at arbitrary sizes.
    icons: [
      {
        src: "/mellowa-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    categories: ["health", "lifestyle", "productivity"],
    orientation: "portrait",
  };
}
