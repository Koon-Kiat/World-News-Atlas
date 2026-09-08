import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { render } from "./render-saved";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorldNewsExplorer } from "@/components/WorldNewsExplorer";
import { buildNewsResponse, DEFAULT_NEWS_QUERY } from "@/lib/news/query";
import { getFixtureStories } from "@/data/fixture-news";

vi.mock("@/components/map/WorldMap", () => ({ WorldMap: () => <div>Map</div> }));
vi.mock("@/components/news/StoryList", () => ({ StoryList: ({ stories }: { stories: Array<{ id: string; title: string }> }) => <div>{stories.map((story) => <article key={story.id}>{story.title}</article>)}</div> }));
const initial = () => buildNewsResponse(getFixtureStories(), DEFAULT_NEWS_QUERY, "database");
beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("uses the stored first page without a duplicate hydration fetch and debounces ten keystrokes to one search", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(initial()));
  vi.stubGlobal("fetch", fetcher);
  render(<WorldNewsExplorer initialData={initial()} initialStored mode="country" />);
  await act(async () => {});
  expect(fetcher).not.toHaveBeenCalled();
  const input = screen.getByRole("searchbox", { name: "Search news" });
  for (const query of ["t", "te", "tec", "tech", "techn", "techno", "technol", "technolo", "technolog", "technology"]) {
    fireEvent.change(input, { target: { value: query } });
    await act(async () => vi.advanceTimersByTimeAsync(20));
  }
  expect(fetcher).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(400));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0]?.[0])).toContain("search=technology");
  expect(fetcher.mock.calls[0]?.[1]).not.toHaveProperty("cache", "no-store");
});

it("submits immediately, preserves history, and discards an older request even if it ignores abort", async () => {
  let resolveOld: ((value: Response) => void) | undefined;
  const old = new Promise<Response>((resolve) => { resolveOld = resolve; });
  const newest = initial(); newest.stories = [{ ...getFixtureStories()[0], title: "Newest requested result" }];
  const fetcher = vi.fn().mockReturnValueOnce(old).mockResolvedValueOnce(Response.json(newest));
  vi.stubGlobal("fetch", fetcher);
  render(<WorldNewsExplorer initialData={initial()} initialStored mode="country" />);
  const input = screen.getByRole("searchbox", { name: "Search news" });
  fireEvent.change(input, { target: { value: "old" } }); fireEvent.submit(input.closest("form")!);
  await act(async () => {});
  const signal = fetcher.mock.calls[0][1].signal as AbortSignal;
  fireEvent.change(input, { target: { value: "new" } }); fireEvent.submit(input.closest("form")!);
  await act(async () => {});
  expect(signal.aborted).toBe(true);
  await act(async () => resolveOld?.(Response.json(initial())));
  expect(screen.getByText("Newest requested result")).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(Object.values(window.localStorage).join(" ")).toContain("new");
});

it("allows only one page request and prevents its results or continuation from crossing a changed search", async () => {
  const first = initial();
  first.meta.hasMore = true; first.meta.nextPage = 2; first.meta.coverageComplete = true;
  let finishPage: ((value: Response) => void) | undefined;
  const pending = new Promise<Response>((resolve) => { finishPage = resolve; });
  const changed = initial();
  changed.stories = [{ ...getFixtureStories()[0], id: "new-query-story", title: "New filter result" }];
  changed.meta.hasMore = false; changed.meta.nextPage = null;
  const fetcher = vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce(Response.json(changed));
  vi.stubGlobal("fetch", fetcher);
  render(<WorldNewsExplorer initialData={first} initialStored mode="country" />);
  const more = screen.getByRole("button", { name: "Load more" });
  fireEvent.click(more); fireEvent.click(more);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0][0])).toContain("page=2");
  const signal = fetcher.mock.calls[0][1].signal as AbortSignal;
  const input = screen.getByRole("searchbox", { name: "Search news" });
  fireEvent.change(input, { target: { value: "changed" } }); fireEvent.submit(input.closest("form")!);
  await act(async () => {});
  expect(signal.aborted).toBe(true);
  const stale = initial(); stale.meta.page = 2; stale.meta.continuationId = "obsolete-continuation";
  stale.stories = [{ ...getFixtureStories()[0], id: "old-page", title: "Obsolete page result" }];
  await act(async () => finishPage?.(Response.json(stale)));
  expect(screen.getByText("New filter result")).toBeInTheDocument();
  expect(screen.queryByText("Obsolete page result")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  expect(String(fetcher.mock.calls[1][0])).not.toContain("continuation");
});

it("keeps stories after an automatic prefetch failure and lets Load more retry manually", async () => {
  let intersect: ((entries: Array<{ isIntersecting: boolean }>) => void) | undefined;
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: typeof intersect) { intersect = callback; }
    observe() {} disconnect() {}
  });
  const first = initial(); first.meta.hasMore = true; first.meta.nextPage = 2; first.meta.coverageComplete = true;
  const next = initial(); next.meta.page = 2; next.meta.hasMore = false; next.meta.nextPage = null;
  next.stories = [{ ...getFixtureStories()[0], id: "manual-result", title: "Manually retried story" }];
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(Response.json(next));
  vi.stubGlobal("fetch", fetcher);
  render(<WorldNewsExplorer initialData={first} initialStored mode="country" />);
  await act(async () => intersect?.([{ isIntersecting: true }]));
  expect(screen.getByText(first.stories[0].title)).toBeInTheDocument();
  expect(screen.getByText("Could not load more coverage. Use Load more to try again.")).toBeInTheDocument();
  await act(async () => { intersect?.([{ isIntersecting: true }]); await vi.advanceTimersByTimeAsync(10_000); });
  expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  await act(async () => {});
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(screen.getByText("Manually retried story")).toBeInTheDocument();
});
