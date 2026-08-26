import { WorldNewsExplorer, type ExplorerMode } from "@/components/WorldNewsExplorer";
import { buildNewsResponse, DEFAULT_NEWS_QUERY } from "@/lib/news/query";

export function WorldNewsPage({ mode }: { mode: ExplorerMode }) {
  const initialData = buildNewsResponse(
    [],
    DEFAULT_NEWS_QUERY,
    "live",
  );
  return <WorldNewsExplorer key={mode} initialData={initialData} mode={mode} />;
}
