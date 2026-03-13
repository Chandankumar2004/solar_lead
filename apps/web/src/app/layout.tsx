import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  metadataBase: new URL("https://solar-lead.onrender.com"),
  title: {
    default: "Solar Lead",
    template: "%s | Solar Lead"
  },
  description: "Solar panel installation lead management and consultation portal"
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
