import { afterEach, describe, expect, it, vi } from "vitest";
import { databaseCandidateLimit, loadDatabaseStories, providerSearchQuery } from "@/lib/news/data-store";
import type { NewsStore } from "@/lib/news/store";
import type { NewsQuery } from "@/lib/news/types";

const query: NewsQuery = { countries: [], sourcePerspective: "all", sources: [], period: "30d", sort: "newest", page: 1, pageSize: 12 };

afterEach(() => { delete process.env.NEWS_DATABASE_CANDIDATE_LIMIT; });

describe("database candidate window", () => {
  it("delegates D1 reads through the NewsStore abstraction", async () => {
    const loadStories = vi.fn(async () => []);
    await loadDatabaseStories(query, { loadStories } as unknown as NewsStore);
    expect(loadStories).toHaveBeenCalledWith(query, expect.any(Date));
  });

  it("clamps operator configuration to a safe range", () => {
    process.env.NEWS_DATABASE_CANDIDATE_LIMIT = "12";
    expect(databaseCandidateLimit()).toBe(300);
    process.env.NEWS_DATABASE_CANDIDATE_LIMIT = "999999";
    expect(databaseCandidateLimit()).toBe(5_000);
  });

  it("builds Japanese and English country aliases without losing Unicode", () => {
    const discovery = providerSearchQuery({ ...query, countries: ["JP"] });
    expect(discovery).toContain('\"Japan\"');
    expect(discovery).toContain('\"日本\"');
    expect(discovery).toContain('\"日本国\"');
  });
});
