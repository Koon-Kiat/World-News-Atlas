import type { Metadata } from "next";
import { SavedArticlesPage } from "@/components/SavedArticlesPage";

export const metadata: Metadata = {
  title: "Saved Articles",
  description: "Return to stories saved for later in World News Atlas.",
};

export default function SavedPage() {
  return <SavedArticlesPage />;
}
