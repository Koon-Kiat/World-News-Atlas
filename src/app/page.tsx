import type { Metadata } from "next";
import { LandingPage } from "@/components/LandingPage";

export const metadata: Metadata = {
  description: "Explore current news through one country or compare the connections between two.",
};

export default function HomePage() {
  return <LandingPage />;
}
