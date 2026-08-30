import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { databaseCandidateLimit, loadDatabaseStories, providerSearchQuery } from "@/lib/news/data-store";
import type { NewsQuery } from "@/lib/news/types";

const query: NewsQuery = {
  countries: [],
  sourcePerspective: "all",
  sources: [],
  period: "30d",
  sort: "newest",
  page: 1,
  pageSize: 12,
};

afterEach(() => {
  delete process.env.NEWS_DATABASE_CANDIDATE_LIMIT;
});

describe("database candidate window", () => {
  it("passes a bounded take value to Prisma before application ranking", async () => {
    const findMany = vi.fn(async () => []);
    const client = { story: { findMany } } as unknown as PrismaClient;
    await loadDatabaseStories(query, client);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 1_000 }));
  });

  it("clamps operator configuration to a safe range", () => {
    process.env.NEWS_DATABASE_CANDIDATE_LIMIT = "12";
    expect(databaseCandidateLimit()).toBe(300);
    process.env.NEWS_DATABASE_CANDIDATE_LIMIT = "999999";
    expect(databaseCandidateLimit()).toBe(5_000);
  });

  it("builds Japanese and English country discovery aliases without losing Unicode", () => {
    expect(providerSearchQuery({ ...query, countries: ["JP"] })).toBe(
      '("Japan" OR "日本" OR "日本国")',
    );
  });
});
