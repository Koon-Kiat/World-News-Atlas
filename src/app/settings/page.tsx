import type { Metadata } from "next";
import { NewsSettings } from "@/components/NewsSettings";

export const metadata: Metadata = {
  title: "News Settings | World News Atlas",
  description: "Choose the default publication range for World News Atlas briefings.",
};

export default function SettingsPage() {
  return <NewsSettings />;
}
