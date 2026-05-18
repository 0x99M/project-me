import type { Metadata } from "next";
import { Comfortaa } from "next/font/google";
import "./portfolio.css";

const comfortaa = Comfortaa({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-comfortaa",
  display: "swap",
});

export const metadata: Metadata = {
  title: "0x99M Portfolio",
  description:
    "Full-stack engineer with 4+ years of experience building scalable SaaS platforms",
};

export default function PortfolioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className={`portfolio-root ${comfortaa.variable}`}>{children}</div>;
}
