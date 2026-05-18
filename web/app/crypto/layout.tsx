import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import ReactQueryProvider from "@/providers/react-query";

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Chart Swipe",
  description: "Watch market with ease",
};

export default function CryptoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider
      signInUrl="/crypto/login"
      signUpUrl="/crypto/sign-up"
      signInFallbackRedirectUrl="/crypto"
      signUpFallbackRedirectUrl="/crypto"
    >
      <div className={`crypto-root dark ${montserrat.variable} antialiased`}>
        <ReactQueryProvider>{children}</ReactQueryProvider>
      </div>
    </ClerkProvider>
  );
}
