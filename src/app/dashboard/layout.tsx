import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Pick split activities and merge them into one.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/dashboard" },
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
