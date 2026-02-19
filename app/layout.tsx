import type { Metadata } from "next";
import { Outfit, Space_Grotesk, Caveat } from "next/font/google";
import "./globals.css";
import WalletProvider from "@/components/WalletProvider";
import SmoothScroll from "@/components/SmoothScroll";
import VoiceAgent from "@/components/VoiceAgent";
import AnimatedBackground from "@/components/AnimatedBackground";

import Preloader from "@/components/Preloader";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  display: 'swap',
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space",
  subsets: ["latin"],
  display: 'swap',
});

const caveat = Caveat({
  variable: "--font-hand",
  subsets: ["latin"],
  display: 'swap',
});

export const metadata: Metadata = {
  title: "Dart - Prediction Markets on Aleo",
  description: "Bet on anything. Stay anonymous if you want. Privacy-first prediction markets powered by Aleo blockchain.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Suppress wallet extension errors
              const originalError = console.error;
              console.error = function(...args) {
                const msg = args[0]?.toString() || '';
                // Filter out wallet extension errors
                if (msg.includes('sseError') ||
                    msg.includes('chrome-extension://') ||
                    msg.includes('inpage.js')) {
                  return;
                }
                originalError.apply(console, args);
              };
            `,
          }}
        />
      </head>
      <body
        className={`${outfit.variable} ${spaceGrotesk.variable} ${caveat.variable} antialiased text-white font-sans`}
        suppressHydrationWarning
      >
        <WalletProvider>
          <AnimatedBackground />
          <Preloader />
          <SmoothScroll />
          {children}
          <VoiceAgent />
        </WalletProvider>
      </body>
    </html>
  );
}
