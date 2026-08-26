import { getCountryName } from "./countries/metadata";
import type { NewsQuery, StoryView } from "./types";

const COMMON_COUNTRY_NAMES: Record<string, string[]> = {
  US: ["united states", "u.s.", "american"],
  GB: ["united kingdom", "britain", "british"],
  AE: ["united arab emirates", "uae", "emirati"],
  KR: ["south korea", "korean"],
  KP: ["north korea", "north korean"],
};

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function titleMentionsCountry(title: string, code: string): boolean {
  const normalized = title.toLowerCase();
  const candidates = COMMON_COUNTRY_NAMES[code] ?? [getCountryName(code).toLowerCase()];
  return candidates.some((candidate) => normalized.includes(candidate));
}

export function scoreTwoCountryRelevance(
  story: StoryView,
  firstCountry: string,
  secondCountry: string,
): number {
  const first = story.countries.find((country) => country.code === firstCountry);
  const second = story.countries.find((country) => country.code === secondCountry);
  if (!first || !second) return 0;

  const relationshipStrength =
    ((first?.relevanceScore ?? 0.62) + (second?.relevanceScore ?? 0.62)) / 2;
  const countryDilution = Math.min(1, 2 / Math.max(2, story.countries.length));
  const firstTitleMention = titleMentionsCountry(story.title, firstCountry);
  const secondTitleMention = titleMentionsCountry(story.title, secondCountry);
  const titleFocus = firstTitleMention && secondTitleMention
    ? 1
    : firstTitleMention || secondTitleMention
      ? 0.62
      : 0.45;
  const publisherCountries = new Set(
    story.articles.map((article) => article.source.countryCode).filter(Boolean),
  );
  const bilateralCoverage = publisherCountries.has(firstCountry) && publisherCountries.has(secondCountry)
    ? 1
    : publisherCountries.has(firstCountry) || publisherCountries.has(secondCountry)
      ? 0.8
      : 0.65;

  return clamp(
    relationshipStrength * 0.5 +
      countryDilution * 0.2 +
      titleFocus * 0.2 +
      bilateralCoverage * 0.1,
  );
}

function recencyScore(story: StoryView, now: Date): number {
  const ageHours = Math.max(
    0,
    (now.getTime() - new Date(story.lastUpdatedAt).getTime()) / 3_600_000,
  );
  return Math.exp(-ageHours / 48);
}

function independentSourceScore(story: StoryView): number {
  const sources = new Set(
    story.articles.map((article) => article.source.domain ?? article.source.name),
  ).size;
  return clamp(0.55 + Math.log2(Math.max(1, sources)) * 0.18);
}

function sourceDiversityScore(story: StoryView): number {
  const countries = new Set(
    story.articles.map((article) => article.source.countryCode).filter(Boolean),
  ).size;
  return clamp(0.55 + countries * 0.15);
}

function geographicScore(story: StoryView, countries: string[]): number {
  if (countries.length === 0) return clamp(0.58 + story.countries.length * 0.08);
  if (countries.length === 2) {
    return scoreTwoCountryRelevance(story, countries[0], countries[1]);
  }
  return story.countries.find((country) => country.code === countries[0])?.relevanceScore ?? 0;
}

export function scoreStory(story: StoryView, query: NewsQuery, now = new Date()): number {
  const geographic = geographicScore(story, query.countries);
  return clamp(
    recencyScore(story, now) * 0.29 +
      geographic * 0.3 +
      story.importanceScore * 0.22 +
      independentSourceScore(story) * 0.13 +
      sourceDiversityScore(story) * 0.06,
  );
}

export function rankStories(
  stories: StoryView[],
  query: NewsQuery,
  now = new Date(),
): StoryView[] {
  return stories
    .map((story) => ({ ...story, rankScore: scoreStory(story, query, now) }))
    .sort(
      (a, b) =>
        (b.rankScore ?? 0) - (a.rankScore ?? 0) ||
        new Date(b.lastUpdatedAt).getTime() - new Date(a.lastUpdatedAt).getTime(),
    );
}
