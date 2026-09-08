import { WorldNewsExplorer, type ExplorerMode } from "@/components/WorldNewsExplorer";
import { buildNewsResponse, DEFAULT_NEWS_QUERY } from "@/lib/news/query";
import { getInitialNews } from "@/lib/news/initial-news.server";

export async function WorldNewsPage({ mode }: { mode: ExplorerMode }) {
  const stored = await getInitialNews(DEFAULT_NEWS_QUERY);
  const initialData = stored ?? buildNewsResponse(
    [],
    DEFAULT_NEWS_QUERY,
    "live",
  );
  return <WorldNewsExplorer key={mode} initialData={initialData} initialStored={Boolean(stored)} mode={mode} />;
}
