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
  sort: "newest",
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

  it("filters by stable publisher ID while retaining display-name compatibility", () => {
    const stories = getFixtureStories();
    const stableId = stories[0].articles[0].source.id;
    const byId = queryStories(stories, { ...baseQuery, sources: [stableId] });
    const byName = queryStories(stories, { ...baseQuery, sources: [stories[0].articles[0].source.name] });
    expect(byId.stories.length).toBeGreaterThan(0);
    expect(byId.stories.flatMap((story) => story.articles).every((article) => article.source.id === stableId)).toBe(true);
    expect(byName.stories.map(({ id }) => id)).toEqual(byId.stories.map(({ id }) => id));
    expect(byId.sourceFacets.find(({ id }) => id === stableId)?.storyCount).toBeGreaterThan(0);
  });

  it("filters domainless publishers by stable ID and legacy display name", () => {
    const template = getFixtureStories()[0];
    const article = {
      ...template.articles[0],
      id: "domainless-example",
      source: {
        ...template.articles[0].source,
        id: "name:example-news:global",
        name: "Example News",
        domain: null,
        countryCode: null,
      },
    };
    const stories = [{ ...template, id: "domainless-story", articles: [article] }];

    const byId = queryStories(stories, {
      ...baseQuery,
      sources: ["name:example-news:global"],
    });
    const byName = queryStories(stories, {
      ...baseQuery,
      sources: ["Example News"],
    });

    expect(byId.stories.map(({ id }) => id)).toEqual(["domainless-story"]);
    expect(byName.stories.map(({ id }) => id)).toEqual(["domainless-story"]);
    expect(byId.sourceFacets).toContainEqual(expect.objectContaining({
      id: "name:example-news:global",
      name: "Example News",
      storyCount: 1,
    }));
  });

  it("derives language facets from the matching result set", () => {
    const result = queryStories(getFixtureStories(), baseQuery);
    expect(result.languageFacets).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "en", label: "English", storyCount: expect.any(Number) }),
    ]));
  });

  it("combines country, local perspective, and Japanese language filters", () => {
    const template = getFixtureStories()[0];
    const localJapanese = {
      ...template.articles[0],
      id: "jp-local-ja",
      language: "ja",
      source: {
        ...template.articles[0].source,
        id: "nhk",
        name: "NHK",
        domain: "nhk.or.jp",
        countryCode: "JP",
        language: "ja",
      },
    };
    const internationalEnglish = {
      ...template.articles[1],
      id: "international-en",
      language: "en",
      source: { ...template.articles[1].source, countryCode: "GB" },
    };
    const result = queryStories([{ ...template, articles: [localJapanese, internationalEnglish] }], {
      ...baseQuery,
      countries: ["JP"],
      sourcePerspective: "local",
      language: "ja",
    });
    expect(result.stories).toHaveLength(1);
    expect(result.stories[0].articles.map(({ id }) => id)).toEqual(["jp-local-ja"]);
    expect(result.languageFacets).toEqual([expect.objectContaining({ code: "ja" })]);
  });

  it("keeps an explicitly selected publisher in facets even when its count is zero", () => {
    const result = queryStories(getFixtureStories(), { ...baseQuery, sources: ["nhk"] });
    expect(result.stories).toHaveLength(0);
    expect(result.sourceFacets).toContainEqual(expect.objectContaining({ id: "nhk", name: "NHK", storyCount: 0 }));
  });

  it("filters each story's coverage to articles that match the selected topic", () => {
    const result = queryStories(getFixtureStories(), {
      ...baseQuery,
      topic: "business",
    });

    expect(result.stories.length).toBeGreaterThan(0);
    expect(result.stories.every((story) => story.topics[0] === "business")).toBe(true);
    expect(
      result.stories.flatMap((story) => story.articles).every((article) => article.topics.includes("business")),
    ).toBe(true);
  });

  it("sorts newest by publication time and popular by coverage strength", () => {
    const template = getFixtureStories()[0];
    const newest = {
      ...template,
      id: "newest-story",
      lastUpdatedAt: "2026-08-27T11:00:00Z",
      importanceScore: 0.2,
      articles: [template.articles[0]],
    };
    const popular = {
      ...template,
      id: "popular-story",
      lastUpdatedAt: "2026-08-27T01:00:00Z",
      importanceScore: 1,
      articles: [
        template.articles[0],
        { ...template.articles[1], id: "popular-second", source: { ...template.articles[1].source, domain: "second.example", countryCode: "SG" } },
        { ...template.articles[2], id: "popular-third", source: { ...template.articles[2].source, domain: "third.example", countryCode: "GB" } },
      ],
    };
    const now = new Date("2026-08-27T12:00:00Z");

    expect(queryStories([popular, newest], { ...baseQuery, sort: "newest", period: "30d" }, now).stories[0].id).toBe("newest-story");
    expect(queryStories([popular, newest], { ...baseQuery, sort: "popular", period: "30d" }, now).stories[0].id).toBe("popular-story");
  });
});

describe("API query validation", () => {
  it("parses a typed two-country query", () => {
    const query = parseNewsQuery(
      new URLSearchParams("countries=jp,sg&sourcePerspective=second-country&period=24h&sort=popular&page=2"),
    );
    expect(query).toMatchObject({
      countries: ["JP", "SG"],
      sourcePerspective: "second-country",
      period: "24h",
      sort: "popular",
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
    "sort=trending",
  ])("rejects invalid parameters: %s", (parameters) => {
    expect(() => parseNewsQuery(new URLSearchParams(parameters))).toThrow(
      NewsQueryValidationError,
    );
  });
});
