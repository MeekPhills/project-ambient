import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: {
    default: "Project Ambient — Your collection, alive at the right moment",
    template: "%s · Project Ambient",
  },
  description:
    "An open-source, local-first wallpaper system for macOS that turns your own photos and videos into power-aware smart channels.",
  keywords: ["macOS wallpaper", "open source wallpaper", "live wallpaper", "local first", "Aerial", "MCP"],
  authors: [{ name: "Project Ambient contributors" }],
  creator: "Project Ambient",
  applicationName: "Project Ambient",
  category: "Technology",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Project Ambient — Your collection, alive at the right moment",
    description: "A local-first, power-aware wallpaper system for the media you already love.",
    type: "website",
    siteName: "Project Ambient",
    images: [{ url: "/og-project-ambient.png", width: 1731, height: 909, alt: "Project Ambient — Your collection, alive at the right moment" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Project Ambient",
    description: "Your collection, alive at the right moment. Open source and local first.",
    images: ["/og-project-ambient.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <a className="skip-link" href="#main-content">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
