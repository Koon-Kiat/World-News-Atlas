import type { NewsPeriod } from "@/lib/news/types";
import { FilterSelect } from "./FilterSelect";

const TOPICS = ["all", "politics", "business", "technology", "society", "climate", "transport"];
const LANGUAGE_OPTIONS = [
  { value: "all", label: "All languages" },
  { value: "en", label: "English" },
  { value: "ja", label: "Japanese" },
  { value: "zh", label: "Chinese" },
];
const PERIOD_OPTIONS: Array<{ value: NewsPeriod; label: string }> = [
  { value: "latest", label: "Latest" },
  { value: "24h", label: "Past 24 hours" },
  { value: "7d", label: "Past 7 days" },
];

interface NewsFiltersProps {
  topic: string;
  language: string;
  period: NewsPeriod;
  onTopicChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onPeriodChange: (value: NewsPeriod) => void;
}

export function NewsFilters({
  topic,
  language,
  period,
  onTopicChange,
  onLanguageChange,
  onPeriodChange,
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
        <FilterSelect
          label="Language"
          value={language}
          options={LANGUAGE_OPTIONS}
          onChange={onLanguageChange}
        />
        <FilterSelect
          label="Published"
          value={period}
          options={PERIOD_OPTIONS}
          onChange={onPeriodChange}
        />
      </div>
    </div>
  );
}
