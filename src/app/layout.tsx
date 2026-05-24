import type { Metadata, Viewport } from "next";
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

const siteUrl = process.env.APP_URL ?? "http://localhost:3000";

const description =
  "Merge split workouts into one activity on Strava and Garmin. Fix your watch's accidental laps and delete the broken originals automatically.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Activity Merger",
    template: "%s - Activity Merger",
  },
  description,
  applicationName: "Activity Merger",
  authors: [{ name: "Activity Merger" }],
  creator: "Activity Merger",
  publisher: "Activity Merger",
  keywords: [
    "merge strava activities",
    "combine garmin activities",
    "split activity fix",
    "merge fit files",
    "join two runs",
    "join two rides",
    "garmin connect merge",
    "strava merge tool",
    "activity editor",
    "fit file merger",
  ],
  category: "fitness",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    siteName: "Activity Merger",
    title: "Activity Merger",
    description,
    url: "/",
    locale: "en_US",
    images: [
      {
        url: "/logo.svg",
        width: 512,
        height: 512,
        alt: "Activity Merger",
      },
    ],
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
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#09090b" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
  colorScheme: "dark",
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
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
