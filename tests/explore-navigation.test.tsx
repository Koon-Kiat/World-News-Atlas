import { render } from "./render-saved";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExploreNavigation, HeaderTools } from "@/components/ExploreNavigation";

beforeEach(() => {
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

describe("explore navigation", () => {
  it("keeps both reading modes, settings, and appearance controls together", () => {
    render(<><ExploreNavigation active="country" /><HeaderTools active="country" /></>);

    expect(screen.getByRole("link", { name: /One country/i })).toHaveAttribute("href", "/country#top");
    expect(screen.getByRole("link", { name: /Compare two/i })).toHaveAttribute("href", "/compare#top");
    expect(screen.queryByText("01")).not.toBeInTheDocument();
    expect(screen.queryByText("02")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open profile menu" }));
    expect(screen.getByRole("link", { name: /Saved articles/i })).toHaveAttribute("href", "/saved");
    expect(screen.getByRole("link", { name: /Settings/i })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("button", { name: "System" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Light" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dark" })).toBeInTheDocument();
  });
});
