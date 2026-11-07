import type { Metadata } from "next";
import localFont from "next/font/local";
import "./solo.css";

// Self-hosted variable Archivo (latin, 100-900), shared with /portfolio:
// next/font/google's Archivo CSS fails Turbopack builds.
const archivo = localFont({
  src: "../fonts/Archivo-latin.woff2",
  weight: "100 900",
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
  return (
    <div className={`solo-root ${archivo.variable}`}>
      {/* Paint the whole page canvas (html/body) to match, so overscroll never
          flashes white. Scoped to /solo: this <style> is only in the DOM while
          this layout is mounted, so /portfolio and / keep their own background. */}
      <style
        dangerouslySetInnerHTML={{
          __html:
            "html,body{background:#f4f3f1}@media(prefers-color-scheme:dark){html,body{background:#141312}}",
        }}
      />
      {children}
    </div>
  );
}
