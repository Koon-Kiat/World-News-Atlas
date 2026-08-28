import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StoryCard } from "@/components/news/StoryCard";
import type { StoryView } from "@/lib/news/types";

afterEach(cleanup);

const story: StoryView = {
  id: "reader-story",
  title: "A shared technology project takes shape",
  summary: "Officials outlined the project and the next steps for residents.",
  firstPublishedAt: "2026-08-28T01:00:00.000Z",
  lastUpdatedAt: "2026-08-28T02:00:00.000Z",
  countries: [],
  topics: ["Technology"],
  importanceScore: 0.8,
  articles: [{
    id: "reader-article",
    provider: "RSS",
    providerArticleId: "one",
    title: "A shared technology project takes shape",
    description: "The publisher supplied this concise description.",
    url: "https://example.com/story",
    canonicalUrl: "https://example.com/story",
    imageUrl: null,
    publishedAt: "2026-08-28T01:00:00.000Z",
    language: "en",
    source: {
      name: "Example News",
      domain: "example.com",
      countryCode: null,
      region: null,
      language: "en",
      scope: "INTERNATIONAL",
      qualityScore: 0.8,
    },
    countries: [],
    topics: ["Technology"],
    importanceScore: 0.8,
    relevanceScore: 0.6,
  }],
};

describe("Worldline Reader", () => {
  it("opens from the entire story card and offers an explicit publisher choice", () => {
    render(<StoryCard story={story} />);

    expect(screen.getByText("Global")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Read A shared technology project.*Worldline Reader/i }));

    expect(screen.getByRole("dialog", { name: story.title })).toBeInTheDocument();
    expect(screen.getByText("Choose how to read")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Example News/i })).toHaveAttribute("href", "https://example.com/story");

    fireEvent.click(screen.getByRole("button", { name: "Close reader" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
