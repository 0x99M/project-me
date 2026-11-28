import type { Metadata, Viewport } from "next";
import "./hearts-v6.css";

export const metadata: Metadata = {
  title: "M ❤ S",
  description: "مهما انكسر… يرمّمه الذهب.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0609",
  colorScheme: "dark",
};

export default function HeartsV6Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Scoped to /hearts-v6: one fixed, non-scrolling dark screen with no overscroll flash. */}
      <style
        dangerouslySetInnerHTML={{
          __html:
            "html,body{height:100%;overflow:hidden;overscroll-behavior:none;background:#0b0609}",
        }}
      />
      {children}
    </>
  );
}
