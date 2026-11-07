import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./portfolio.css";

// Self-hosted (both OFL, latin subset from Google Fonts) rather than
// next/font/google: Turbopack fails Railway's build on Archivo's Google CSS
// ("next/font/google queries have exactly one entry"), and local files also
// keep the build off the network.
const anton = localFont({
  src: "./fonts/Anton-latin.woff2",
  weight: "400",
  variable: "--font-pf-display",
  display: "swap",
});

const archivo = localFont({
  src: "../fonts/Archivo-latin.woff2",
  weight: "400 700",
  variable: "--font-pf-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "0x99M — Mustafa builds things that ship",
  description:
    "Solo developer. Shadowkit, Videos.Recipes, Clipmer and more: designed, built and run by one person.",
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default function PortfolioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`pf-root ${anton.variable} ${archivo.variable}`}>
      {children}
    </div>
  );
}
