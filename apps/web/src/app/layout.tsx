import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Mifluent",
    template: "%s · Mifluent",
  },
  description:
    "Monitoring that works out what to monitor. Describe your business and get a morning digest of what changed around it — and what it means for you.",
  // This is a self-hosted instance holding one business's private research
  // profile. It has no reason to appear in anyone's search results.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
