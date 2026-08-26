import { z } from "zod";
import { getCountryName, normalizeCountryCode } from "./countries/metadata";
import { newsPeriodHours } from "./periods";
import { rankStories, scoreTwoCountryRelevance } from "./ranking";
import type {
  ArticleView,
  NewsQuery,
  NewsResponse,
  SourcePerspective,
  StoryView,
} from "./types";

const perspectiveSchema = z.enum([
  "all",
  "local",
  "international",
  "first-country",
  "second-country",
]);
const periodSchema = z.enum(["latest", "24h", "7d", "30d"]);
const MIN_BILATERAL_RELEVANCE = 0.56;

export class NewsQueryValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super("Invalid news query");
    this.name = "NewsQueryValidationError";
  }
}

function positiveInteger(value: string | null, fallback: number, maximum: number): number {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) throw new NewsQueryValidationError(["Pagination values must be integers"]);
  const parsed = Number(value);
  if (parsed < 1 || parsed > maximum) {
    throw new NewsQueryValidationError([`Pagination value must be between 1 and ${maximum}`]);
  }
  return parsed;
}

function parseCountries(value: string | null): string[] {
  if (!value) return [];
  const raw = value.split(",").map((country) => country.trim());
  if (raw.length > 2) throw new NewsQueryValidationError(["Select no more than two countries"]);
  const countries = raw.map((country) => normalizeCountryCode(country));
  if (countries.some((country) => country === null)) {
    throw new NewsQueryValidationError(["Countries must be valid ISO 3166-1 alpha-2 codes"]);
  }
  const normalized = countries as string[];
  if (new Set(normalized).size !== normalized.length) {
    throw new NewsQueryValidationError(["Country selections must be unique"]);
  }
  return normalized;
}

function parseSources(searchParams: URLSearchParams): string[] {
  const sources = [...new Set(searchParams.getAll("source").map((value) => value.trim()).filter(Boolean))];
  if (
    sources.length > 20 ||
    sources.some((source) => source.length > 80 || /[\u0000-\u001f\u007f]/.test(source))
  ) {
    throw new NewsQueryValidationError(["Select no more than 20 valid news outlets"]);
  }
  return sources;
}

function parseOptionalToken(
  value: string | null,
  label: string,
  expression: RegExp,
  maximumLength: number,
): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized.length > maximumLength || !expression.test(normalized)) {
    throw new NewsQueryValidationError([`Invalid ${label}`]);
  }
  return normalized;
}

function validatePerspective(
  perspective: SourcePerspective,
  countryCount: number,
): SourcePerspective {
  const allowed =
    countryCount === 0
      ? ["all"]
      : countryCount === 1
        ? ["all", "local", "international"]
        : ["all", "first-country", "second-country", "international"];
  if (!allowed.includes(perspective)) {
    throw new NewsQueryValidationError([
      `sourcePerspective '${perspective}' is not valid for ${countryCount} selected countries`,
    ]);
  }
  return perspective;
}

export function parseNewsQuery(searchParams: URLSearchParams): NewsQuery {
  const countries = parseCountries(searchParams.get("countries"));
  const perspectiveResult = perspectiveSchema.safeParse(
    searchParams.get("sourcePerspective") ?? "all",
  );
  const periodResult = periodSchema.safeParse(searchParams.get("period") ?? "latest");
  if (!perspectiveResult.success || !periodResult.success) {
    throw new NewsQueryValidationError(["Invalid sourcePerspective or period"]);
  }

  const rawSearch = searchParams.get("search")?.trim();
  if (rawSearch && rawSearch.length > 120) {
    throw new NewsQueryValidationError(["Search must be 120 characters or fewer"]);
  }

  return {
    countries,
    sourcePerspective: validatePerspective(perspectiveResult.data, countries.length),
    sources: parseSources(searchParams),
    topic: parseOptionalToken(searchParams.get("topic"), "topic", /^[a-z0-9-]+$/, 40),
    language: parseOptionalToken(
      searchParams.get("language"),
      "language",
      /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/,
      12,
    ),
    period: periodResult.data,
    search: rawSearch || undefined,
    page: positiveInteger(searchParams.get("page"), 1, 100),
    pageSize: positiveInteger(searchParams.get("pageSize"), 12, 250),
  };
}

function perspectiveMatches(
  article: ArticleView,
  perspective: SourcePerspective,
  countries: string[],
): boolean {
  const sourceCountry = article.source.countryCode;
  if (perspective === "all") return true;
  if (perspective === "local") return sourceCountry === countries[0];
  if (perspective === "first-country") return sourceCountry === countries[0];
  if (perspective === "second-country") return sourceCountry === countries[1];
  return !countries.includes(sourceCountry ?? "");
}

function matchesSearch(story: StoryView, search: string): boolean {
  const needle = search.toLocaleLowerCase();
  const haystack = [
    story.title,
    story.summary ?? "",
    ...story.topics,
    ...story.countries.map((country) => country.name),
    ...story.articles.flatMap((article) => [
      article.title,
      article.description ?? "",
      article.source.name,
    ]),
  ]
    .join(" ")
    .toLocaleLowerCase();
  return haystack.includes(needle);
}

function storyMatchesCountry(
  story: StoryView,
  code: string,
  includePublisherCountry: boolean,
): boolean {
  if (story.countries.some((country) => country.code === code)) return true;
  return includePublisherCountry && story.articles.some((article) => article.source.countryCode === code);
}

function hasFocusedBilateralSignal(story: StoryView, countries: string[]): boolean {
  if (story.countries.length <= 4) return true;
  return countries.every((code) =>
    story.countries.some(
      (country) => country.code === code && country.relevanceScore >= 0.85,
    ),
  );
}

export function queryStories(
  stories: StoryView[],
  query: NewsQuery,
  now = new Date(),
): {
  stories: StoryView[];
  total: number;
  sourceFacets: Array<{ name: string; storyCount: number }>;
} {
  const cutoff = now.getTime() - newsPeriodHours(query.period) * 3_600_000;
  const candidates = stories
    .filter((story) => new Date(story.lastUpdatedAt).getTime() >= cutoff)
    .filter((story) => {
      if (query.countries.length !== 2) {
        return query.countries.every((code) => storyMatchesCountry(story, code, false));
      }
      return (
        query.countries.every((code) => storyMatchesCountry(story, code, true)) &&
        hasFocusedBilateralSignal(story, query.countries) &&
        scoreTwoCountryRelevance(story, query.countries[0], query.countries[1]) >= MIN_BILATERAL_RELEVANCE
      );
    })
    .filter((story) => !query.topic || story.topics.includes(query.topic))
    .filter(
      (story) =>
        !query.language || story.articles.some((article) => article.language === query.language),
    )
    .filter((story) => !query.search || matchesSearch(story, query.search));

  const sourceCounts = new Map<string, number>();
  for (const story of candidates) {
    const storySources = new Set(story.articles.map((article) => article.source.name));
    for (const source of storySources) sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
  }
  const sourceFacets = [...sourceCounts.entries()]
    .map(([name, storyCount]) => ({ name, storyCount }))
    .sort((left, right) => right.storyCount - left.storyCount || left.name.localeCompare(right.name));

  const selectedSources = new Set(query.sources);
  const matching = candidates
    .map((story) => ({
      ...story,
      articles: story.articles.filter(
        (article) =>
          perspectiveMatches(article, query.sourcePerspective, query.countries) &&
          (selectedSources.size === 0 || selectedSources.has(article.source.name)),
      ),
    }))
    .filter((story) => story.articles.length > 0);

  const ranked = rankStories(matching, query, now);
  const start = (query.page - 1) * query.pageSize;
  return {
    stories: ranked.slice(start, start + query.pageSize),
    total: ranked.length,
    sourceFacets,
  };
}

export function buildNewsResponse(
  stories: StoryView[],
  query: NewsQuery,
  dataSource: NewsResponse["meta"]["dataSource"],
  notice?: string,
): NewsResponse {
  const result = queryStories(stories, query);
  return {
    stories: result.stories,
    meta: {
      selectedCountries: query.countries.map((code) => ({ code, name: getCountryName(code) })),
      total: result.total,
      page: query.page,
      pageSize: query.pageSize,
      dataSource,
      sourceFacets: result.sourceFacets,
      generatedAt: new Date().toISOString(),
      notice,
    },
  };
}

export const DEFAULT_NEWS_QUERY: NewsQuery = {
  countries: [],
  sourcePerspective: "all",
  sources: [],
  period: "latest",
  page: 1,
  pageSize: 12,
};
