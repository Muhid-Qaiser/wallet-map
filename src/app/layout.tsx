import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wallet Map · Follow the connections",
  description:
    "Explore Ethereum and Base wallet relationships with an interactive graph and transfer evidence.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
