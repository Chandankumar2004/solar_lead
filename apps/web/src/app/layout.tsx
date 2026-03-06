import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Solar Lead Admin",
  description: "Solar panel installation lead management"
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

