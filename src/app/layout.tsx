import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OutdoorPal · GeoAI Hackathon @ IIT Bombay",
  description: "An SLM-powered outdoor activity assistant that recommends where and when to head outdoors, grounded in live weather + geospatial data.",
  keywords: ["GeoAI", "Hackathon", "IIT Bombay", "Outdoor Assistant", "SLM", "Qwen", "OpenStreetMap", "Open-Meteo"],
  authors: [{ name: "GeoAI Hackathon Team" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "OutdoorPal · GeoAI Hackathon @ IIT Bombay",
    description: "SLM-powered outdoor activity assistant with live weather + geospatial data.",
    url: "https://chat.z.ai",
    siteName: "OutdoorPal",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "OutdoorPal · GeoAI Hackathon",
    description: "SLM-powered outdoor activity assistant",
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
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
