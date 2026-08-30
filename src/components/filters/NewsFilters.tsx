import type { LanguageFacet, NewsPeriod, NewsSort, SourceFacet } from "@/lib/news/types";
import { NEWS_PERIOD_OPTIONS } from "@/lib/news/periods";
import { TOPIC_DEFINITIONS } from "@/lib/news/topics";
import { FilterSelect } from "./FilterSelect";
import { SourceFilter } from "./SourceFilter";

const TOPICS = [{ slug: "all", label: "All" }, ...TOPIC_DEFINITIONS.map(({ slug, label }) => ({ slug, label }))];
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
  selectedCountries: string[];
  availableSources: SourceFacet[];
  availableLanguages: LanguageFacet[];
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
  selectedCountries,
  availableSources,
  availableLanguages,
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
              key={item.slug}
              className={topic === item.slug ? "topic-chip active" : "topic-chip"}
              aria-pressed={topic === item.slug}
              onClick={() => onTopicChange(item.slug)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="compact-filters">
        <SourceFilter
          availableSources={availableSources}
          selectedCountries={selectedCountries}
          value={sources}
          onChange={onSourcesChange}
        />
        <FilterSelect
          label="Language"
          value={language}
          options={[
            { value: "all", label: "All languages" },
            ...availableLanguages.map(({ code, label, storyCount }) => ({
              value: code,
              label: `${label} (${storyCount})`,
            })),
          ]}
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
