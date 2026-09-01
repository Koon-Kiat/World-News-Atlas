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
    const findMany = vi.fn(async (arguments_: unknown) => {
      void arguments_;
      return [];
    });
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
    const discovery = providerSearchQuery({ ...query, countries: ["JP"] });
    expect(discovery).toContain('"Japan"');
    expect(discovery).toContain('"日本"');
    expect(discovery).toContain('"日本国"');
  });

  it("matches a stable domainless source name exactly in Prisma", async () => {
    const findMany = vi.fn(async (arguments_: unknown) => {
      void arguments_;
      return [];
    });
    const client = { story: { findMany } } as unknown as PrismaClient;

    await loadDatabaseStories({
      ...query,
      sources: ["name:example-news:global"],
    }, client);

    const invocation = findMany.mock.calls[0]?.[0] as { where: unknown } | undefined;
    expect(invocation).toBeDefined();
    const where = JSON.stringify(invocation?.where);
    expect(where).toContain('"equals":"Example News"');
    expect(where).not.toContain('"contains":"Example News"');
  });
});
