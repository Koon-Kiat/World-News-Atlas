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
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
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

describe("landing page", () => {
  it("presents the two core journeys in the full-width navigation and page content", () => {
    const { container } = render(<LandingPage />);

    const navigation = screen.getByRole("navigation", { name: "World News Atlas sections" });
    const utilityHeader = container.querySelector(".landing-utility-header");
    expect(navigation.compareDocumentPosition(utilityHeader as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /One country/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /Compare two/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Open settings" })).toBeInTheDocument();
  });

  it("contains all four scroll-story chapters and both destination calls to action", () => {
    render(<LandingPage />);

    expect(screen.getByRole("heading", { name: "Scroll through the anatomy of a story." })).toBeInTheDocument();
    expect(screen.getByText("A headline starts somewhere.")).toBeInTheDocument();
    expect(screen.getByText("One place brings the story into focus.")).toBeInTheDocument();
    expect(screen.getByText("A second place reveals the relationship.")).toBeInTheDocument();
    expect(screen.getByText("Many reports become one coherent story.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open the country map/i })).toHaveAttribute("href", "/country#top");
    expect(screen.getByRole("link", { name: /Build a comparison/i })).toHaveAttribute("href", "/compare#top");
  });

  it("uses icon controls with accessible theme labels", () => {
    render(<LandingPage />);

    expect(screen.getByRole("button", { name: "System" })).toHaveTextContent("◐");
    expect(screen.getByRole("button", { name: "Light" })).toHaveTextContent("☀");
    expect(screen.getByRole("button", { name: "Dark" })).toHaveTextContent("☾");
  });
});
