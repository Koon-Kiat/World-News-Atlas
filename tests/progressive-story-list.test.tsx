import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProgressiveStoryList } from "@/components/WorldNewsExplorer";
import { getFixtureStories } from "@/data/fixture-news";
import type { StoryView } from "@/lib/news/types";

let observerCallback: IntersectionObserverCallback | null = null;

class TestIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) {
    observerCallback = callback;
  }

  observe() {}
  disconnect() {}
  unobserve() {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
  readonly root = null;
  readonly rootMargin = "0px";
  readonly thresholds = [0];
}

function stories(count: number): StoryView[] {
  const source = getFixtureStories()[0];
  return Array.from({ length: count }, (_, index) => ({
    ...source,
    id: `${source.id}-${index}`,
    title: `${source.title} ${index + 1}`,
  }));
}

afterEach(() => {
  cleanup();
  observerCallback = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("progressive story list", () => {
  it("reveals additional country stories as the sentinel enters view", async () => {
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    render(
      <ProgressiveStoryList
        stories={stories(25)}
        canFetchMore={false}
        isFetchingMore={false}
        onRequestMore={() => {}}
      />,
    );

    expect(screen.getAllByRole("article")).toHaveLength(12);
    await act(async () => observerCallback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ));
    expect(screen.getAllByRole("article")).toHaveLength(24);
  });

  it("requests the next API page when all received stories are visible", async () => {
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    const onRequestMore = vi.fn();
    render(
      <ProgressiveStoryList
        stories={stories(12)}
        canFetchMore
        isFetchingMore={false}
        onRequestMore={onRequestMore}
      />,
    );

    await act(async () => observerCallback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ));
    expect(onRequestMore).toHaveBeenCalledTimes(1);
  });

  it("prefetches only after the ready buffer crosses the low-water threshold", async () => {
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    const onRequestMore = vi.fn();
    render(
      <ProgressiveStoryList
        stories={stories(48)}
        canFetchMore
        isFetchingMore={false}
        onRequestMore={onRequestMore}
      />,
    );

    expect(onRequestMore).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
    expect(screen.queryByText(/^Page \d+/i)).not.toBeInTheDocument();

    await act(async () => observerCallback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ));
    expect(screen.getAllByRole("article")).toHaveLength(24);
    expect(onRequestMore).toHaveBeenCalledTimes(1);
  });

  it("continues requesting later pages as appended stories are consumed", async () => {
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    const onRequestMore = vi.fn();
    const view = render(
      <ProgressiveStoryList
        stories={stories(12)}
        canFetchMore
        isFetchingMore={false}
        onRequestMore={onRequestMore}
      />,
    );

    await act(async () => observerCallback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ));
    expect(onRequestMore).toHaveBeenCalledTimes(1);

    view.rerender(
      <ProgressiveStoryList
        stories={stories(24)}
        canFetchMore
        isFetchingMore={false}
        onRequestMore={onRequestMore}
      />,
    );
    await act(async () => observerCallback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ));
    expect(screen.getAllByRole("article")).toHaveLength(24);
    await act(async () => observerCallback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ));
    expect(onRequestMore).toHaveBeenCalledTimes(2);
  });

  it("backs off before prefetching after a duplicate-only stage", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    const onRequestMore = vi.fn();
    const view = render(
      <ProgressiveStoryList
        stories={stories(12)}
        canFetchMore
        isFetchingMore={false}
        onRequestMore={onRequestMore}
        continuationVersion={0}
      />,
    );

    await act(async () => observerCallback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ));
    expect(onRequestMore).toHaveBeenCalledTimes(1);

    await act(async () => view.rerender(
      <ProgressiveStoryList
        stories={stories(12)}
        canFetchMore
        isFetchingMore={false}
        onRequestMore={onRequestMore}
        continuationVersion={1}
      />,
    ));
    expect(onRequestMore).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(1_499));
    expect(onRequestMore).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(onRequestMore).toHaveBeenCalledTimes(2);
  });

  it("stops automatic retries after four duplicate-only stages", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    const onRequestMore = vi.fn();
    const view = render(
      <ProgressiveStoryList
        stories={stories(12)}
        canFetchMore
        isFetchingMore={false}
        onRequestMore={onRequestMore}
        continuationVersion={0}
      />,
    );

    await act(async () => vi.runOnlyPendingTimersAsync());
    expect(onRequestMore).toHaveBeenCalledTimes(1);

    for (let version = 1; version <= 5; version += 1) {
      await act(async () => view.rerender(
        <ProgressiveStoryList
          stories={stories(12)}
          canFetchMore
          isFetchingMore={false}
          onRequestMore={onRequestMore}
          continuationVersion={version}
        />,
      ));
      await act(async () => vi.advanceTimersByTimeAsync(12_000));
    }

    expect(onRequestMore).toHaveBeenCalledTimes(5);
  });

  it("stops requesting when the server reports no further usable page", async () => {
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    const onRequestMore = vi.fn();
    render(
      <ProgressiveStoryList
        stories={stories(24)}
        canFetchMore={false}
        isFetchingMore={false}
        onRequestMore={onRequestMore}
      />,
    );

    await act(async () => observerCallback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ));
    expect(screen.getByText("All available matching stories are loaded.")).toBeInTheDocument();
    expect(onRequestMore).not.toHaveBeenCalled();
  });
});
