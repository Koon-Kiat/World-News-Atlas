import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeControl } from "@/components/ThemeControl";
import { THEME_STORAGE_KEY } from "@/lib/theme";

let prefersDark = false;
let mediaListener: ((event: MediaQueryListEvent) => void) | null = null;

function installMatchMedia(): void {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: prefersDark,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
      mediaListener = listener;
    }),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
}

beforeEach(() => {
  prefersDark = false;
  mediaListener = null;
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themePreference;
  document.documentElement.style.colorScheme = "";
  installMatchMedia();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("theme preference", () => {
  it("defaults to the current system theme", () => {
    prefersDark = true;
    render(<ThemeControl />);

    expect(screen.getByRole("button", { name: "System" })).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.dataset.themePreference).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("persists and applies a manual override", () => {
    render(<ThemeControl />);
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
  });

  it("restores a persisted manual override", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    prefersDark = true;
    render(<ThemeControl />);

    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("tracks system changes while system mode is selected", () => {
    render(<ThemeControl />);
    expect(document.documentElement.dataset.theme).toBe("light");

    prefersDark = true;
    act(() => mediaListener?.({ matches: true } as MediaQueryListEvent));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
