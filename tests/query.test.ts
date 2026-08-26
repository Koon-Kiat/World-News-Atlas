import { describe, expect, it } from "vitest";
import { getFixtureStories } from "@/data/fixture-news";
import {
  NewsQueryValidationError,
  parseNewsQuery,
  queryStories,
} from "@/lib/news/query";
import type { NewsQuery } from "@/lib/news/types";

const baseQuery: NewsQuery = {
  countries: [],
  sourcePerspective: "all",
  sources: [],
  period: "7d",
  page: 1,
  pageSize: 50,
};

describe("news matching", () => {
  it("matches all stories involving one selected country", () => {
    const result = queryStories(getFixtureStories(), { ...baseQuery, countries: ["JP"] });
    expect(result.stories.length).toBeGreaterThan(1);
    expect(result.stories.every((story) => story.countries.some(({ code }) => code === "JP"))).toBe(true);
  });

  it("returns only meaningful two-country connections", () => {
    const result = queryStories(getFixtureStories(), {
      ...baseQuery,
      countries: ["JP", "SG"],
    });
    expect(result.stories[0].id).toBe("fixture-story-jp-sg-digital-corridor");
    expect(result.stories.length).toBeGreaterThan(0);
    expect(
      result.stories.every((story) =>
        ["JP", "SG"].every(
          (code) => story.countries.some((country) => country.code === code),
        ),
      ),
    ).toBe(true);
  });

  it("excludes stories that involve only one side of a comparison", () => {
    const result = queryStories(getFixtureStories(), {
      ...baseQuery,
      countries: ["JP", "SG"],
    });
    expect(result.stories.some((story) =>
      story.countries.some((country) => country.code === "JP") &&
      !story.countries.some((country) => country.code === "SG")
    )).toBe(false);
  });

  it("excludes broad country lists without a focused bilateral signal", () => {
    const direct = getFixtureStories().find((story) => story.id === "fixture-story-jp-sg-digital-corridor")!;
    const incidental = {
      ...direct,
      id: "incidental-country-list",
      countries: [
        { code: "JP", name: "Japan", relevanceScore: 0.73 },
        { code: "SG", name: "Singapore", relevanceScore: 0.73 },
        { code: "US", name: "United States", relevanceScore: 0.73 },
        { code: "GB", name: "United Kingdom", relevanceScore: 0.73 },
        { code: "FR", name: "France", relevanceScore: 0.73 },
      ],
    };
    const result = queryStories([incidental], {
      ...baseQuery,
      countries: ["JP", "SG"],
    });
    expect(result.stories).toHaveLength(0);
  });

  it("does not mistake a publisher's home country for a bilateral connection", () => {
    const sourceStory = getFixtureStories().find((story) =>
      story.countries.some((country) => country.code === "US"),
    );
    expect(sourceStory).toBeDefined();
    const contextualStory = {
      ...sourceStory!,
      id: "contextual-sg-us",
      countries: sourceStory!.countries.filter((country) => country.code === "US"),
      articles: sourceStory!.articles.map((article) => ({
        ...article,
        source: { ...article.source, countryCode: "SG" },
        countries: article.countries.filter((country) => country.code === "US"),
      })),
    };

    const result = queryStories([contextualStory], {
      ...baseQuery,
      countries: ["SG", "US"],
    });

    expect(result.stories).toHaveLength(0);
  });

  it("classifies local and international sources from publisher country", () => {
    const local = queryStories(getFixtureStories(), {
      ...baseQuery,
      countries: ["JP"],
      sourcePerspective: "local",
    });
    expect(local.stories.flatMap((story) => story.articles).every((article) => article.source.countryCode === "JP")).toBe(true);

    const international = queryStories(getFixtureStories(), {
      ...baseQuery,
      countries: ["JP"],
      sourcePerspective: "international",
    });
    expect(international.stories.flatMap((story) => story.articles).every((article) => article.source.countryCode !== "JP")).toBe(true);
  });

  it("supports first-country, second-country and international bilateral perspectives", () => {
    const first = queryStories(getFixtureStories(), {
      ...baseQuery,
      countries: ["JP", "SG"],
      sourcePerspective: "first-country",
    });
    const second = queryStories(getFixtureStories(), {
      ...baseQuery,
      countries: ["JP", "SG"],
      sourcePerspective: "second-country",
    });
    const international = queryStories(getFixtureStories(), {
      ...baseQuery,
      countries: ["JP", "SG"],
      sourcePerspective: "international",
    });
    expect(first.stories[0].articles.every((article) => article.source.countryCode === "JP")).toBe(true);
    expect(second.stories[0].articles.every((article) => article.source.countryCode === "SG")).toBe(true);
    expect(international.stories[0].articles.every((article) => !["JP", "SG"].includes(article.source.countryCode ?? ""))).toBe(true);
  });

  it("filters stories and coverage by selected news outlet", () => {
    const sourceName = getFixtureStories()[0].articles[0].source.name;
    const result = queryStories(getFixtureStories(), {
      ...baseQuery,
      sources: [sourceName],
    });
    expect(result.stories.length).toBeGreaterThan(0);
    expect(result.stories.flatMap((story) => story.articles).every((article) => article.source.name === sourceName)).toBe(true);
    expect(result.sourceFacets.some((source) => source.name === sourceName && source.storyCount > 0)).toBe(true);
  });
});

describe("API query validation", () => {
  it("parses a typed two-country query", () => {
    const query = parseNewsQuery(
      new URLSearchParams("countries=jp,sg&sourcePerspective=second-country&period=24h&page=2"),
    );
    expect(query).toMatchObject({
      countries: ["JP", "SG"],
      sourcePerspective: "second-country",
      period: "24h",
      page: 2,
    });
  });

  it("supports a 30-day range and a progressively rendered response size", () => {
    const query = parseNewsQuery(new URLSearchParams("period=30d&pageSize=250"));
    expect(query).toMatchObject({ period: "30d", pageSize: 250 });
  });

  it("parses repeated outlet filters", () => {
    const query = parseNewsQuery(new URLSearchParams("source=CNA&source=The+Japan+Times"));
    expect(query.sources).toEqual(["CNA", "The Japan Times"]);
  });

  it.each([
    "countries=JP,SG,US",
    "countries=ZZ",
    "countries=JP,JP",
    "countries=JP&sourcePerspective=first-country",
    "search=" + "x".repeat(121),
  ])("rejects invalid parameters: %s", (parameters) => {
    expect(() => parseNewsQuery(new URLSearchParams(parameters))).toThrow(
      NewsQueryValidationError,
    );
  });
});
