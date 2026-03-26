import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Providers from "@/components/Providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DeskRPG — Virtual Office with AI Employees",
  description: "Build your virtual office, hire AI employees, and achieve business goals with other players in a 2D pixel art RPG workspace.",
  keywords: ["DeskRPG", "virtual office", "AI employees", "pixel art", "RPG", "multiplayer", "workspace", "2D game"],
  authors: [{ name: "Dante Labs", url: "https://dante-labs.com" }],
  openGraph: {
    title: "DeskRPG",
    description: "2D Pixel Art RPG — Build your virtual office with AI employees",
    siteName: "DeskRPG",
    type: "website",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col"><Providers>{children}</Providers></body>
    </html>
  );
}
