import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LandingPage } from "@/components/LandingPage";

class TestIntersectionObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
  readonly root = null;
  readonly rootMargin = "0px";
  readonly thresholds = [0];
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("landing page", () => {
  it("keeps the landing page focused while presenting both core journeys", () => {
    render(<LandingPage />);

    expect(screen.queryByRole("navigation", { name: "World News Atlas sections" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /One country/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /Compare two/i }).length).toBeGreaterThan(0);
  });

  it("contains all four scroll-story chapters and both destination calls to action", () => {
    render(<LandingPage />);

    expect(screen.getByRole("heading", { name: "Watch one signal become a world story." })).toBeInTheDocument();
    expect(screen.getByText("A headline starts somewhere.")).toBeInTheDocument();
    expect(screen.getByText("One place brings the story into focus.")).toBeInTheDocument();
    expect(screen.getByText("A second place reveals the relationship.")).toBeInTheDocument();
    expect(screen.getByText("Many reports become one coherent story.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open the country map/i })).toHaveAttribute("href", "/country#top");
    expect(screen.getByRole("link", { name: /Build a comparison/i })).toHaveAttribute("href", "/compare#top");
  });

  it("uses interactive world globes for the hero and scroll narrative", () => {
    render(<LandingPage />);

    expect(screen.getAllByLabelText(/Interactive rotating world globe/i)).toHaveLength(2);
    expect(screen.getByText(/Drag to rotate 360°/i)).toBeInTheDocument();
  });
});
