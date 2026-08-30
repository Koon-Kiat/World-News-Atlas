import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeaderTools } from "@/components/ExploreNavigation";
import { StoryCard } from "@/components/news/StoryCard";
import type { StoryView } from "@/lib/news/types";

const story: StoryView = {
  id: "saved-story",
  title: "A story worth returning to",
  summary: "A useful summary.",
  firstPublishedAt: "2026-08-30T00:00:00.000Z",
  lastUpdatedAt: "2026-08-30T00:00:00.000Z",
  countries: [],
  topics: ["world"],
  importanceScore: 0.8,
  articles: [],
};

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    media: "",
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("saved articles", () => {
  it("persists a story and reflects it in the profile menu", () => {
    render(<><StoryCard story={story} /><HeaderTools active="country" /></>);

    fireEvent.click(screen.getByRole("button", { name: `Save ${story.title} for later` }));

    expect(screen.getByRole("button", { name: `Remove ${story.title} from saved articles` })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("1 saved articles")).toBeInTheDocument();
    expect(window.localStorage.getItem("worldline:saved-stories:v1")).toContain("saved-story");
  });
});
