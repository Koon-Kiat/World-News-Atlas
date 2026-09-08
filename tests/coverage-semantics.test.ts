import { describe, expect, it, vi } from "vitest";
import { getFixtureStories } from "@/data/fixture-news";
import { buildCoverageAwareDataset, type LoadedNewsDataset } from "@/lib/news/data-store";
import { buildNewsResponse, DEFAULT_NEWS_QUERY } from "@/lib/news/query";

function liveDataset(stories = getFixtureStories().slice(0, 1)): Omit<LoadedNewsDataset, "dataSource"> {
  return {
    stories,
    articleCount: new Set(stories.flatMap(({ articles }) => articles.map(({ canonicalUrl }) => canonicalUrl))).size,
    corpusComplete: true,
    discoveryExhausted: true,
    archiveCoverageComplete: false,
    coverageComplete: false,
    coverageDegraded: false,
    coverageStatus: "limited",
    coverageReasons: ["NO_ARCHIVE_PROVIDER"],
    corpusLimitReached: false,
    diagnostics: {
      rawArticleCount: stories.flatMap(({ articles }) => articles).length,
      normalizedArticleCount: stories.flatMap(({ articles }) => articles).length,
      relevantArticleCount: stories.flatMap(({ articles }) => articles).length,
      duplicateArticleCount: 0,
      providerContributions: [],
    },
  };
}

describe("coverage-aware database supplementation", () => {
  it("avoids live calls when fresh archive watermarks prove the database window complete", async () => {
    const stored = getFixtureStories().slice(0, 1);
    const loader = vi.fn(async () => liveDataset());
    const result = await buildCoverageAwareDataset(
      { ...DEFAULT_NEWS_QUERY, countries: ["JP"], period: "30d" },
      stored,
      { complete: true, archiveComplete: true, reasons: [], checkpointCount: 1 },
      loader,
    );
    expect(loader).not.toHaveBeenCalled();
    expect(result).toMatchObject({ dataSource: "database", coverageComplete: true, archiveCoverageComplete: true });
  });

  it("supplements partial stored coverage and deduplicates overlapping live articles", async () => {
    const stored = getFixtureStories().slice(0, 1);
    const duplicate = stored[0];
    const template = stored[0].articles[0];
    const uniqueArticle = {
      ...template,
      id: "live-unique",
      providerArticleId: "live-unique",
      title: "Distinct regional ferry safety review",
      url: "https://live.example/ferry-review",
      canonicalUrl: "https://live.example/ferry-review",
    };
    const uniqueStory = { ...stored[0], id: "live-story", title: uniqueArticle.title, articles: [uniqueArticle] };
    const loader = vi.fn(async () => liveDataset([duplicate, uniqueStory]));
    const result = await buildCoverageAwareDataset(
      { ...DEFAULT_NEWS_QUERY, countries: ["JP"], period: "30d" },
      stored,
      { complete: false, archiveComplete: false, reasons: ["DATABASE_WINDOW_PARTIAL"], checkpointCount: 1 },
      loader,
    );
    expect(loader).toHaveBeenCalledOnce();
    expect(result.dataSource).toBe("hybrid");
    expect(result.articleCount).toBe(new Set(stored[0].articles.map(({ canonicalUrl }) => canonicalUrl)).size + 1);
    expect(result.diagnostics?.duplicateArticleCount).toBeGreaterThan(0);
    expect(result.coverageComplete).toBe(false);
  });

  it("retains an explicit live continuation when ingestion completes the stored window", async () => {
    const loader = vi.fn(async () => ({ ...liveDataset(), continuationId: "active-snapshot" }));
    const query = { ...DEFAULT_NEWS_QUERY, continuationId: "active-snapshot" };
    const result = await buildCoverageAwareDataset(query, getFixtureStories().slice(0, 1),
      { complete: true, archiveComplete: true, reasons: [], checkpointCount: 1 }, loader);
    expect(loader).toHaveBeenCalledWith(query);
    expect(result.continuationId).toBe("active-snapshot");
    expect(result.dataSource).toBe("hybrid");
  });
});

describe("completion semantics", () => {
  it("allows hasMore=false while historical coverage remains limited", () => {
    const query = { ...DEFAULT_NEWS_QUERY, period: "30d" as const };
    const response = buildNewsResponse(getFixtureStories(), query, "live", undefined, {
      corpusComplete: true,
      discoveryExhausted: true,
      archiveCoverageComplete: false,
      coverageComplete: false,
      coverageStatus: "limited",
      coverageReasons: ["NO_ARCHIVE_PROVIDER"],
    });
    expect(response.meta).toMatchObject({ hasMore: false, coverageComplete: false, coverageStatus: "limited" });
  });

  it("marks a fully walked archive window complete", () => {
    const response = buildNewsResponse(getFixtureStories(), { ...DEFAULT_NEWS_QUERY, period: "30d" }, "live", undefined, {
      corpusComplete: true,
      discoveryExhausted: true,
      archiveCoverageComplete: true,
      coverageComplete: true,
      coverageStatus: "complete",
    });
    expect(response.meta).toMatchObject({ coverageComplete: true, archiveCoverageComplete: true });
  });

  it("does not call a safety-cap stop complete coverage", () => {
    const response = buildNewsResponse(getFixtureStories(), DEFAULT_NEWS_QUERY, "live", undefined, {
      corpusComplete: true,
      discoveryExhausted: false,
      archiveCoverageComplete: false,
      coverageComplete: false,
      coverageStatus: "limited",
      corpusLimitReached: true,
      coverageReasons: ["CORPUS_LIMIT_REACHED"],
    });
    expect(response.meta).toMatchObject({ corpusLimitReached: true, coverageComplete: false });
  });
});
