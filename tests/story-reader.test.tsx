import { render } from "./render-saved";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoryCard } from "@/components/news/StoryCard";
import type { StoryView } from "@/lib/news/types";

const elementScrollTo = vi.fn();

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  elementScrollTo.mockClear();
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: elementScrollTo,
  });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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
      id: "domain:example.com",
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
  it("keeps keyboard focus inside the open reader", async () => {
    render(<StoryCard story={story} />);
    fireEvent.click(screen.getByRole("button", { name: /Read A shared technology project.*Worldline Reader/i }));
    const dialog = await screen.findByRole("dialog", { name: story.title });
    const controls = dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]');
    const first = controls[0];
    const last = controls[controls.length - 1];
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("opens from the entire story card and offers an explicit publisher choice", async () => {
    const { container } = render(<StoryCard story={story} featured />);

    expect(screen.getByText("Global")).toBeInTheDocument();
    expect(container.querySelector(".story-card.is-featured")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Read at Example News" })).toHaveTextContent("Read source");
    fireEvent.click(screen.getByRole("button", { name: /Read A shared technology project.*Worldline Reader/i }));

    expect(await screen.findByRole("dialog", { name: story.title })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to stories" })).toHaveTextContent("Back");
    expect(container.querySelector(".reader-brand")).not.toBeInTheDocument();
    expect(screen.queryByText("Coverage at a glance")).not.toBeInTheDocument();
    expect(screen.getByText("Choose how to read")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Example News/i })).toHaveAttribute("href", "https://example.com/story");
    expect(screen.getByRole("link", { name: "Open A shared technology project takes shape at Example News" })).toHaveAttribute("href", "https://example.com/story");
    expect(screen.queryByRole("button", { name: /Compare .* reports here/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close reader" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(window.scrollTo).toHaveBeenCalled());
  });

  it("scrolls to the source comparison when more than one report is available", async () => {
    const comparisonStory: StoryView = {
      ...story,
      id: "comparison-story",
      articles: [
        ...story.articles,
        {
          ...story.articles[0],
          id: "reader-article-two",
          providerArticleId: "two",
          title: "A second report adds international context",
          url: "https://example.org/story",
          canonicalUrl: "https://example.org/story",
          source: {
            ...story.articles[0].source,
            name: "Example World",
            domain: "example.org",
          },
        },
      ],
    };

    render(<StoryCard story={comparisonStory} />);
    fireEvent.click(screen.getByRole("button", { name: /Read A shared technology project.*Worldline Reader/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Compare 2 reports here" }));

    expect(elementScrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "smooth" }));
    expect(screen.getByRole("heading", { name: "2 reports in this story" }).closest("section")).toHaveFocus();
  });
});
