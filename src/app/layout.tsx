import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { PwaRegistration } from "@/components/PwaRegistration";
import { SavedStoriesProvider } from "@/hooks/useSavedStories";
import "flag-icons/css/flag-icons.min.css";
import "@fontsource-variable/source-sans-3";
import "@fontsource-variable/source-serif-4";
import "./globals.css";
import "./interface.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://world-news-atlas.bookoonkiat.chatgpt.site"),
  title: {
    default: "World News Atlas | Follow the story across borders",
    template: "%s | World News Atlas",
  },
  description:
    "Explore global news and the stories connecting any two countries through an interactive world map.",
  applicationName: "World News Atlas",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Worldline",
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }, { url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    title: "World News Atlas",
    description: "Follow the story across borders.",
    images: [{ url: "/og.png", width: 1536, height: 1024, alt: "World News Atlas globe connecting two reporting signals" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "World News Atlas",
    description: "Follow the story across borders.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Vinext renders documents on request. Keep the native Next backend equally
  // request-bound so framework inline scripts receive this response's CSP nonce.
  await connection();
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body>
        <a className="skip-link" href="#main-content">Skip to main content</a>
        {/* Retire saved light/system preferences before the first paint. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme.js" />
        <PwaRegistration />
        <SavedStoriesProvider>{children}</SavedStoriesProvider>
      </body>
    </html>
  );
}
