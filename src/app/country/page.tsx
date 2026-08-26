import type { Metadata } from "next";
import { WorldNewsPage } from "@/components/WorldNewsPage";

export const metadata: Metadata = {
  title: "Country News | World News Atlas",
  description: "Explore current world news through one selected country.",
};

export default function CountryNewsPage() {
  return <WorldNewsPage mode="country" />;
}
