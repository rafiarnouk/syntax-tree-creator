import type { Metadata } from "next";
import { Boldonse, Host_Grotesk, IBM_Plex_Mono, IBM_Plex_Serif } from "next/font/google";
import "./globals.css";

const hostGrotesk = Host_Grotesk({
  variable: "--font-host-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const boldonse = Boldonse({
  variable: "--font-boldonse",
  subsets: ["latin"],
  weight: "400",
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const ibmPlexSerif = IBM_Plex_Serif({
  variable: "--font-ibm-plex-serif",
  subsets: ["latin"],
  weight: ["400", "600"],
  style: ["normal", "italic"],
});

// The translucent "glass" look (see the end of globals.css), parked for now.
const GLASS_LOOK = false;

export const metadata: Metadata = {
  title: "Syntax Tree Creator",
  description: "A code-editor-grade bracket notation editor for linguistic syntax trees.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${hostGrotesk.variable} ${boldonse.variable} ${ibmPlexMono.variable} ${ibmPlexSerif.variable}`}
      data-look={GLASS_LOOK ? "glass" : undefined}
    >
      <body>{children}</body>
    </html>
  );
}
