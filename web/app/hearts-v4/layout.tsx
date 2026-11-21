import type { Metadata, Viewport } from "next";
import { Amiri, Cormorant_Garamond, Great_Vibes } from "next/font/google";
import "./hearts-v4.css";

const script = Great_Vibes({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-hv4-script",
  display: "swap",
});

// The scale readout's digits.
const serif = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-hv4-serif",
  display: "swap",
});

// Every caption and label.
const arabic = Amiri({
  subsets: ["arabic"],
  weight: "400",
  variable: "--font-hv4-ar",
  display: "swap",
});

export const metadata: Metadata = {
  title: "M ❤ S",
  description: "من قلبٍ واحد… إلى كلّ شيء.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#07040a",
  colorScheme: "dark",
};

export default function HeartsV4Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`${script.variable} ${serif.variable} ${arabic.variable}`}>
      {/* Scoped to /hearts-v4: one fixed, non-scrolling dark screen with no overscroll flash. */}
      <style
        dangerouslySetInnerHTML={{
          __html:
            "html,body{height:100%;overflow:hidden;overscroll-behavior:none;background:#07040a}",
        }}
      />
      {children}
    </div>
  );
}
