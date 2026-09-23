import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Caption Studio",
  description:
    "Review and apply captions to social and long-form videos.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => {
  const param = new URLSearchParams(window.location.search).get("clawpilotTheme");
  const theme = param || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
})();
if (!new URLSearchParams(window.location.search).has("clawpilotTheme")) {
  document.documentElement.setAttribute("data-theme", "light");
}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
