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
  it("keeps both reading modes, and library controls together", () => {
    render(<><ExploreNavigation active="country" /><HeaderTools active="country" /></>);

    expect(screen.getByRole("link", { name: /One country/i })).toHaveAttribute("href", "/country#top");
    expect(screen.getByRole("link", { name: /Compare two/i })).toHaveAttribute("href", "/compare#top");
    expect(screen.queryByText("01")).not.toBeInTheDocument();
    expect(screen.queryByText("02")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open library menu" }));
    expect(screen.getByRole("link", { name: /Saved articles/i })).toHaveAttribute("href", "/saved");
    expect(screen.getByRole("link", { name: /Settings/i })).toHaveAttribute("href", "/settings");
    expect(screen.queryByRole("button", { name: "System" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Light" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dark" })).not.toBeInTheDocument();
  });
  it("dismisses the library with Escape and returns keyboard focus", () => {
    render(<HeaderTools active="country" />);
    const trigger = screen.getByRole("button", { name: "Open library menu" });
    fireEvent.click(trigger);
    const settings = screen.getByRole("link", { name: /Settings/i });
    settings.focus();
    fireEvent.keyDown(settings, { key: "Escape" });
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});
