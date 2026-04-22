import type { Metadata, Viewport } from "next";
import './globals.css'; // Global styles

export const metadata: Metadata = {
  title: "GenioLingo",
  description: "Tutor de idiomas inteligente para la familia",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
