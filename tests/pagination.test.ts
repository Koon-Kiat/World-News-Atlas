import { describe, expect, it } from "vitest";
import { getFixtureStories } from "@/data/fixture-news";
import { mergeNextPage, nextPageNumber, responseHasNextPage } from "@/lib/news/pagination";
import type { NewsResponse, StoryView } from "@/lib/news/types";

function story(id: string): StoryView {
  return { ...getFixtureStories()[0], id };
}

function datedStory(id: string, lastUpdatedAt: string): StoryView {
  return { ...story(id), lastUpdatedAt };
}

function response(page: number, total: number, stories: StoryView[]): NewsResponse {
  const hasMore = page < 100 && page * 12 < total;
  return {
    stories,
    meta: {
      selectedCountries: [],
      total,
      articleCount: total,
      materializedStoryCount: total,
      hasMore,
      corpusComplete: true,
      discoveryExhausted: true,
      archiveCoverageComplete: true,
      coverageComplete: true,
      coverageDegraded: false,
      coverageStatus: "complete",
      coverageReasons: [],
      corpusLimitReached: false,
      nextPage: hasMore ? page + 1 : null,
      page,
      pageSize: 12,
      dataSource: "live",
      sourceFacets: [],
      languageFacets: [],
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

  it("continues past duplicate cards when authoritative continuation remains", () => {
    const current = [story("known")];
    const merged = mergeNextPage(current, response(2, 60, [story("known")]), 2);
    expect(merged.stories).toHaveLength(1);
    expect(merged.canFetchMore).toBe(true);
  });

  it("can repeat a partial page while provider discovery remains possible", () => {
    const partial = response(3, 25, [story("new")]);
    partial.meta.corpusComplete = false;
    partial.meta.hasMore = true;
    partial.meta.nextPage = 3;
    expect(nextPageNumber(partial)).toBe(3);
    expect(mergeNextPage([], partial, 3).canFetchMore).toBe(true);
  });

  it("rejects a response for an unexpected page", () => {
    const merged = mergeNextPage([story("one")], response(3, 60, [story("two")]), 2);
    expect(merged.stories).toHaveLength(2);
    expect(merged.canFetchMore).toBe(false);
  });

  it("inserts later-discovered stories into strict newest-first order", () => {
    const current = [datedStory("older", "2026-08-20T00:00:00Z")];
    const next = response(2, 60, [datedStory("newer", "2026-08-30T00:00:00Z")]);
    const merged = mergeNextPage(current, next, 2, "newest");

    expect(merged.stories.map(({ id }) => id)).toEqual(["newer", "older"]);
  });
});
