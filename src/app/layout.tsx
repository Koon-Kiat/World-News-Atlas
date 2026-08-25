import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Worldline — World news, mapped",
  description:
    "Explore global news and the stories connecting any two countries through an interactive world map.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
