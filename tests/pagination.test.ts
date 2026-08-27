import { describe, expect, it } from "vitest";
import { getFixtureStories } from "@/data/fixture-news";
import { mergeNextPage, nextPageNumber, responseHasNextPage } from "@/lib/news/pagination";
import type { NewsResponse, StoryView } from "@/lib/news/types";

function story(id: string): StoryView {
  return { ...getFixtureStories()[0], id };
}

function response(page: number, total: number, stories: StoryView[]): NewsResponse {
  return {
    stories,
    meta: {
      selectedCountries: [],
      total,
      page,
      pageSize: 12,
      dataSource: "live",
      sourceFacets: [],
      generatedAt: new Date().toISOString(),
    },
  };
}

describe("news pagination", () => {
  it("continues while a real later page remains", () => {
    const first = response(1, 30, [story("one")]);
    expect(responseHasNextPage(first)).toBe(true);
    expect(nextPageNumber(first)).toBe(2);
  });

  it("stops at the last page and never produces page 101", () => {
    const last = response(100, 2_000, [story("last")]);
    expect(responseHasNextPage(last)).toBe(false);
    expect(nextPageNumber(last)).toBeNull();
  });

  it("stops when a provider page adds no unique stories", () => {
    const current = [story("known")];
    const merged = mergeNextPage(current, response(2, 60, [story("known")]), 2);
    expect(merged.stories).toHaveLength(1);
    expect(merged.canFetchMore).toBe(false);
  });

  it("rejects a response for an unexpected page", () => {
    const merged = mergeNextPage([story("one")], response(3, 60, [story("two")]), 2);
    expect(merged.stories).toHaveLength(2);
    expect(merged.canFetchMore).toBe(false);
  });
});
