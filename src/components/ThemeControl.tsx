"use client";

import { useThemePreference } from "@/hooks/useThemePreference";
import { THEME_OPTIONS } from "@/lib/theme";

const THEME_ICONS = {
  system: "◐",
  light: "☀",
  dark: "☾",
} as const;

export function ThemeControl({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useThemePreference();
  return (
    <div className={compact ? "theme-control is-compact" : "theme-control"} role="group" aria-label="Color theme">
      {THEME_OPTIONS.map((option) => (
        <button
          type="button"
          key={option.value}
          aria-pressed={theme === option.value}
          aria-label={option.label}
          title={option.description}
          onClick={() => setTheme(option.value)}
        >
          <span className="theme-icon" aria-hidden="true">{THEME_ICONS[option.value]}</span>
          {!compact && <span>{option.label}</span>}
        </button>
      ))}
    </div>
  );
}
