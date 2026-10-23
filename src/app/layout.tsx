import type { Metadata, Viewport } from "next";
import "@flu-wop/design-system/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Studio Control · Mid City Sound",
  description: "Private control panel for the Mid City Sound studios.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#090909",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="studio">
      <body className="bg-surface text-ink antialiased">{children}</body>
    </html>
  );
}
