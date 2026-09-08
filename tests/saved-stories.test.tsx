import { render } from "./render-saved";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeaderTools } from "@/components/ExploreNavigation";
import { StoryCard } from "@/components/news/StoryCard";
import type { StoryView } from "@/lib/news/types";
import { parseSavedStories, SAVED_STORAGE_KEY, useSavedStories } from "@/hooks/useSavedStories";
import { SavedArticlesPage } from "@/components/SavedArticlesPage";

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
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("saved articles", () => {
  it("shares one persisted store, one initial read and one storage listener across cards", () => {
    const read = vi.spyOn(Storage.prototype, "getItem");
    const listen = vi.spyOn(window, "addEventListener");
    function Count() { return <output>{useSavedStories().count} saved</output>; }
    render(<><StoryCard story={story} /><StoryCard story={{ ...story, id: "other", title: "Other story" }} /><Count /></>);
    expect(read.mock.calls.filter(([key]) => key === SAVED_STORAGE_KEY)).toHaveLength(1);
    expect(listen.mock.calls.filter(([type]) => String(type) === "storage")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: `Save ${story.title} for later` }));
    expect(screen.getByText("1 saved")).toBeInTheDocument();
    expect(read.mock.calls.filter(([key]) => key === SAVED_STORAGE_KEY)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: `Remove ${story.title} from saved articles` }));
    expect(screen.getByText("0 saved")).toBeInTheDocument();
  });

  it("safely migrates full legacy snapshots and rejects malformed or future schemas", () => {
    expect(parseSavedStories(JSON.stringify([story]))).toEqual([story]);
    expect(parseSavedStories("invalid json")).toEqual([]);
    expect(parseSavedStories(JSON.stringify([{ id: "bad", title: "Incomplete", articles: [] }]))).toEqual([]);
    expect(parseSavedStories(JSON.stringify([{ ...story, lastUpdatedAt: "yesterday" }]))).toEqual([]);
    expect(parseSavedStories(JSON.stringify({ version: 99, stories: [story] }))).toEqual([]);
    window.localStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify([story]));
    render(<StoryCard story={story} />);
    fireEvent.click(screen.getByRole("button", { name: `Remove ${story.title} from saved articles` }));
    expect(JSON.parse(window.localStorage.getItem(SAVED_STORAGE_KEY)!)).toEqual({ version: 2, stories: [] });
  });

  it("reports quota and restricted storage failures without pretending a save succeeded", () => {
    render(<StoryCard story={story} />);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Quota", "QuotaExceededError"); });
    fireEvent.click(screen.getByRole("button", { name: `Save ${story.title} for later` }));
    expect(screen.getByRole("status")).toHaveTextContent("Could not save");
    expect(screen.getByRole("button", { name: `Save ${story.title} for later` })).toHaveAttribute("aria-pressed", "false");
  });

  it("survives unavailable reads and synchronizes cross-tab changes without another storage read", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("Denied", "SecurityError"); });
    render(<StoryCard story={story} />);
    const reads = get.mock.calls.length;
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: SAVED_STORAGE_KEY, newValue: JSON.stringify({ version: 2, stories: [story] }) })));
    expect(screen.getByRole("button", { name: `Remove ${story.title} from saved articles` })).toHaveAttribute("aria-pressed", "true");
    expect(get).toHaveBeenCalledTimes(reads);
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: null })));
    expect(screen.getByRole("button", { name: `Save ${story.title} for later` })).toBeInTheDocument();
  });

  it("clears and restores the reading list with a bounded Undo window", () => {
    vi.useFakeTimers();
    window.localStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify([story]));
    render(<SavedArticlesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(screen.getByRole("status")).toHaveTextContent("Reading list cleared");
    expect(screen.getByText("Your reading list is empty.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("heading", { name: story.title })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("persists a story and reflects it in the profile menu", () => {
    render(<><StoryCard story={story} /><HeaderTools active="country" /></>);

    fireEvent.click(screen.getByRole("button", { name: `Save ${story.title} for later` }));

    expect(screen.getByRole("button", { name: `Remove ${story.title} from saved articles` })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("1 saved articles")).toBeInTheDocument();
    expect(window.localStorage.getItem("worldline:saved-stories:v1")).toContain("saved-story");
  });
});
