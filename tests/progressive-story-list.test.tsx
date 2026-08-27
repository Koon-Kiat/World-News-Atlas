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
  vi.unstubAllGlobals();
});

describe("progressive story list", () => {
  it("reveals additional country stories as the sentinel enters view", async () => {
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    render(
      <ProgressiveStoryList
        stories={stories(25)}
        total={25}
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
        total={30}
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

  it("continues requesting later pages as appended stories are consumed", async () => {
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    const onRequestMore = vi.fn();
    const view = render(
      <ProgressiveStoryList
        stories={stories(12)}
        total={40}
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
        total={40}
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
});
