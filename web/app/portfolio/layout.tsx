import type { Metadata, Viewport } from "next";
import { Anton, Archivo } from "next/font/google";
import "./portfolio.css";

const anton = Anton({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-pf-display",
  display: "swap",
});

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-pf-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "0x99M — Mustafa builds things that ship",
  description:
    "Solo developer in Amman. Shadowkit, Videos.Recipes, Clipmer and more: designed, built and run by one person.",
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
