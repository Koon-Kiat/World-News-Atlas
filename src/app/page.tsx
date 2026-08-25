import { WorldNewsExplorer } from "@/components/WorldNewsExplorer";
import { getFixtureStories } from "@/data/fixture-news";
import { buildNewsResponse, DEFAULT_NEWS_QUERY } from "@/lib/news/query";

export default function Home() {
  const initialData = buildNewsResponse(
    getFixtureStories(),
    DEFAULT_NEWS_QUERY,
    "fixtures",
    "Sample coverage is shown until a database and news ingestion are configured.",
  );
  return <WorldNewsExplorer initialData={initialData} />;
}
