import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: { default: "DECA", template: "%s | DECA" }, description: "Trade crypto, pay bills and sell gift cards. Fast, clear and trusted." };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0b0b0c" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body className="antialiased">{children}</body></html>;
}
