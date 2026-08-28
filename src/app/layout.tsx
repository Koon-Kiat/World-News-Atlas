import type { Metadata } from "next";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";
import "flag-icons/css/flag-icons.min.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://world-news-atlas.bookoonkiat.chatgpt.site"),
  title: {
    default: "World News Atlas | Follow the story across borders",
    template: "%s | World News Atlas",
  },
  description:
    "Explore global news and the stories connecting any two countries through an interactive world map.",
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }}
          suppressHydrationWarning
        />
        {children}
      </body>
    </html>
  );
}
