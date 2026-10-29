import type { Metadata, Viewport } from "next";
import { Amiri, Great_Vibes } from "next/font/google";
import "./hearts.css";

const script = Great_Vibes({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-hearts-script",
  display: "swap",
});

const arabic = Amiri({
  subsets: ["arabic"],
  weight: "400",
  variable: "--font-hearts-ar",
  display: "swap",
});

export const metadata: Metadata = {
  title: "M ❤ S",
  description: "Draw an S.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#12080f",
  colorScheme: "dark",
};

export default function HeartsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`${script.variable} ${arabic.variable}`}>
      {/* Scoped to /hearts: one fixed, non-scrolling dark screen with no overscroll flash. */}
      <style
        dangerouslySetInnerHTML={{
          __html:
            "html,body{height:100%;overflow:hidden;overscroll-behavior:none;background:#12080f}",
        }}
      />
      {children}
    </div>
  );
}
