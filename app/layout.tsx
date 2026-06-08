import type { Metadata } from "next";
import { Sora, Inter, JetBrains_Mono, Noto_Serif_JP } from "next/font/google";
import "./globals.css";
import WalletProvider from "@/components/WalletProvider";
import { ToastProvider } from "@/components/Toast";

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  display: 'swap',
  weight: ['400', '600', '700', '800'],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: 'swap',
  weight: ['400', '500', '600'],
});

const notoSerifJP = Noto_Serif_JP({
  variable: "--font-noto-serif-jp",
  subsets: ["latin"],
  display: 'swap',
  weight: ['500', '700'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://yosuku.xyz'),
  title: "Yosuku — Prediction Markets on Sui",
  description: "Trade binary positions on BTC price direction. Oracle-based settlement, DUSDC stablecoins, 15-minute rounds.",
  openGraph: {
    title: "Yosuku — Prediction Markets on Sui",
    description: "Trade binary positions on BTC price direction. Oracle-based settlement, DUSDC stablecoins, 15-minute rounds.",
    siteName: "Yosuku",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Yosuku — Prediction Markets on Sui",
    description: "Trade binary positions on BTC price direction. Oracle-based settlement, DUSDC stablecoins, 15-minute rounds.",
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Yosuku',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${sora.variable} ${inter.variable} ${jetbrainsMono.variable} ${notoSerifJP.variable} antialiased cursor-custom`}
        suppressHydrationWarning
      >
        <WalletProvider>
          <ToastProvider>
            {children}
          </ToastProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
