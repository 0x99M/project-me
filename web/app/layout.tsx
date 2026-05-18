import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "0x99M",
  description: "Portfolio and projects by 0x99M",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
