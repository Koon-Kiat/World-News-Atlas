import type { NewsPeriod } from "@/lib/news/types";

const TOPICS = ["all", "politics", "business", "technology", "society", "climate", "transport"];

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
      <div className="compact-filters">
        <label>
          <span className="sr-only">Language</span>
          <select value={language} onChange={(event) => onLanguageChange(event.target.value)}>
            <option value="all">All languages</option>
            <option value="en">English</option>
            <option value="ja">Japanese</option>
            <option value="zh">Chinese</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Time period</span>
          <select
            value={period}
            onChange={(event) => onPeriodChange(event.target.value as NewsPeriod)}
          >
            <option value="latest">Latest</option>
            <option value="24h">Past 24 hours</option>
            <option value="7d">Past 7 days</option>
          </select>
        </label>
      </div>
    </div>
  );
}
