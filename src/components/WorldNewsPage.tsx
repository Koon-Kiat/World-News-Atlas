import { WorldNewsExplorer, type ExplorerMode } from "@/components/WorldNewsExplorer";
import { getFixtureStories } from "@/data/fixture-news";
import { buildNewsResponse, DEFAULT_NEWS_QUERY } from "@/lib/news/query";

export function WorldNewsPage({ mode }: { mode: ExplorerMode }) {
  const initialData = buildNewsResponse(
    getFixtureStories(),
    DEFAULT_NEWS_QUERY,
    "fixtures",
    "No live provider returned usable coverage, so the sample briefing is shown temporarily.",
  );
  return <WorldNewsExplorer key={mode} initialData={initialData} mode={mode} />;
}
