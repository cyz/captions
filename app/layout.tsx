import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Caption Burner — Safe Zone",
  description:
    "Burn captions into vertical videos while respecting the safe zone.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-100 antialiased">
        {children}
      </body>
    </html>
  );
}
