import type { Metadata, Viewport } from "next";
import { Amiri, Great_Vibes } from "next/font/google";
import "./hearts-v3.css";

const script = Great_Vibes({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-hv3-script",
  display: "swap",
});

// Only the counter's digits use it.
const numerals = Amiri({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-hv3-num",
  display: "swap",
});

export const metadata: Metadata = {
  title: "M ❤ S",
  description: "One in 8.33 billion.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0509",
  colorScheme: "dark",
};

export default function HeartsV3Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`${script.variable} ${numerals.variable}`}>
      {/* Scoped to /hearts-v3: one fixed, non-scrolling dark screen with no overscroll flash. */}
      <style
        dangerouslySetInnerHTML={{
          __html:
            "html,body{height:100%;overflow:hidden;overscroll-behavior:none;background:#0b0509}",
        }}
      />
      {children}
    </div>
  );
}
