import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import "./solo.css";

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "800"],
  variable: "--font-archivo",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mustafa Alsheikh — Solo SaaS builder",
  description:
    "Mustafa Alsheikh (0x99M) — a solo SaaS builder. I design, build, and ship SaaS end-to-end: Videos.Recipes, Clipmer, and more.",
};

export default function SoloLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className={`solo-root ${archivo.variable}`}>{children}</div>;
}
