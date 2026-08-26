import type { NewsPeriod } from "@/lib/news/types";
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
interface NewsFiltersProps {
  topic: string;
  language: string;
  period: NewsPeriod;
  sources: string[];
  availableSources: Array<{ name: string; storyCount: number }>;
  onTopicChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onPeriodChange: (value: NewsPeriod) => void;
  onSourcesChange: (value: string[]) => void;
}

export function NewsFilters({
  topic,
  language,
  period,
  sources,
  availableSources,
  onTopicChange,
  onLanguageChange,
  onPeriodChange,
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
      </div>
    </div>
  );
}
