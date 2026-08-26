import type { Metadata } from "next";
import { WorldNewsPage } from "@/components/WorldNewsPage";

export const metadata: Metadata = {
  title: "Compare Countries | World News Atlas",
  description: "Compare current news links and reporting between two countries.",
};

export default function CompareCountriesPage() {
  return <WorldNewsPage mode="compare" />;
}
