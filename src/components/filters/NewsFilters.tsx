import type { NewsPeriod, NewsSort } from "@/lib/news/types";
import { NEWS_PERIOD_OPTIONS } from "@/lib/news/periods";
import { FilterSelect } from "./FilterSelect";
import { SourceFilter } from "./SourceFilter";

const TOPICS = ["all", "politics", "business", "technology", "society", "climate", "transport"];
const LANGUAGE_OPTIONS = [
  { value: "all", label: "All languages" },
  { value: "en", label: "English" },
  { value: "ja", label: "Japanese" },
  { value: "zh", label: "Chinese" },
];
const SORT_OPTIONS: Array<{ value: NewsSort; label: string }> = [
  { value: "newest", label: "Newest first" },
  { value: "popular", label: "Most popular" },
];
interface NewsFiltersProps {
  topic: string;
  language: string;
  period: NewsPeriod;
  sort: NewsSort;
  sources: string[];
  availableSources: Array<{ name: string; storyCount: number }>;
  onTopicChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onPeriodChange: (value: NewsPeriod) => void;
  onSortChange: (value: NewsSort) => void;
  onSourcesChange: (value: string[]) => void;
}

export function NewsFilters({
  topic,
  language,
  period,
  sort,
  sources,
  availableSources,
  onTopicChange,
  onLanguageChange,
  onPeriodChange,
  onSortChange,
  onSourcesChange,
}: NewsFiltersProps) {
  return (
    <div className="filter-bar">
      <div className="topic-filter-group">
        <span className="filter-label">Browse by topic</span>
        <div className="topic-scroller" aria-label="Topic filter">
          {TOPICS.map((item) => (
            <button
              type="button"
              key={item}
              className={topic === item ? "topic-chip active" : "topic-chip"}
              aria-pressed={topic === item}
              onClick={() => onTopicChange(item)}
            >
              {item.charAt(0).toUpperCase() + item.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="compact-filters">
        <SourceFilter availableSources={availableSources} value={sources} onChange={onSourcesChange} />
        <FilterSelect
          label="Language"
          value={language}
          options={LANGUAGE_OPTIONS}
          onChange={onLanguageChange}
        />
        <FilterSelect
          label="Published"
          value={period}
          options={NEWS_PERIOD_OPTIONS.map(({ value, label }) => ({ value, label }))}
          onChange={onPeriodChange}
        />
        <FilterSelect
          label="Sort by"
          value={sort}
          options={SORT_OPTIONS}
          onChange={onSortChange}
        />
      </div>
    </div>
  );
}
