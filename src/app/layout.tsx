import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = process.env.APP_URL ?? "http://localhost:3000";

const description =
  "Merge split Garmin activities into one. Preview the merged recording — elevation, heart rate, pace and route — before deleting anything.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Activity Merger — merge split Garmin activities",
    template: "%s - Activity Merger",
  },
  description,
  applicationName: "Activity Merger",
  keywords: [
    "merge garmin activities",
    "combine garmin activities",
    "garmin connect merge",
    "split activity fix",
    "merge fit files",
    "join two runs",
    "fit file merger",
  ],
  category: "fitness",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Activity Merger",
    title: "Activity Merger — merge split Garmin activities",
    description,
    url: "/",
    locale: "en_US",
    images: [{ url: "/logo.svg", width: 512, height: 512, alt: "Activity Merger" }],
  },
  twitter: {
    card: "summary",
    title: "Activity Merger",
    description,
    images: ["/logo.svg"],
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.ico",
    apple: "/icon.svg",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0d10",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/*
        Deliberately not a flex column: as a column flex container, body sizes
        the line's cross-axis to <main>'s max-content width, which lets a wide
        chart or table stretch the whole page sideways on a phone.
      */}
      <body className="min-h-full w-full">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
