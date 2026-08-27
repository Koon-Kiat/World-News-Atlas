"use client";

import { useThemePreference } from "@/hooks/useThemePreference";
import { THEME_OPTIONS } from "@/lib/theme";

export function ThemeControl({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useThemePreference();
  return (
    <div className={compact ? "theme-control is-compact" : "theme-control"} role="group" aria-label="Color theme">
      {THEME_OPTIONS.map((option) => (
        <button
          type="button"
          key={option.value}
          aria-pressed={theme === option.value}
          title={option.description}
          onClick={() => setTheme(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
