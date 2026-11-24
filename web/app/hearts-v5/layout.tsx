import type { Metadata, Viewport } from "next";
import { Amiri, Cormorant_Garamond, Great_Vibes } from "next/font/google";
import "./hearts-v5.css";

const script = Great_Vibes({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-hv5-script",
  display: "swap",
});

// The ❤ between the names.
const serif = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-hv5-serif",
  display: "swap",
});

// Every caption and label.
const arabic = Amiri({
  subsets: ["arabic"],
  weight: "400",
  variable: "--font-hv5-ar",
  display: "swap",
});

export const metadata: Metadata = {
  title: "M ❤ S",
  description: "مهما اضطرب الماء… نعودُ قلبًا واحدًا.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#07040a",
  colorScheme: "dark",
};

export default function HeartsV5Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`${script.variable} ${serif.variable} ${arabic.variable}`}>
      {/* Scoped to /hearts-v5: one fixed, non-scrolling dark screen with no overscroll flash. */}
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
