import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Connect Garmin",
  description: "Link your Garmin Connect account to merge split activities.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/connect/garmin" },
};

export default function ConnectGarminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
