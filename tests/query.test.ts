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

  it("requires both selected countries for a two-country result", () => {
    const result = queryStories(getFixtureStories(), {
      ...baseQuery,
      countries: ["JP", "SG"],
    });
    expect(result.stories.map((story) => story.id)).toEqual([
      "fixture-story-jp-sg-digital-corridor",
    ]);
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
