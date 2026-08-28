"use client";

import { useThemePreference } from "@/hooks/useThemePreference";
import { THEME_OPTIONS } from "@/lib/theme";

function ThemeIcon({ value }: { value: (typeof THEME_OPTIONS)[number]["value"] }) {
  if (value === "light") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.25" /><path d="M10 2v1.5M10 16.5V18M2 10h1.5M16.5 10H18M4.35 4.35l1.06 1.06M14.59 14.59l1.06 1.06M15.65 4.35l-1.06 1.06M5.41 14.59l-1.06 1.06" /></svg>;
  }
  if (value === "dark") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16.8 12.25A7 7 0 0 1 7.75 3.2a7 7 0 1 0 9.05 9.05Z" /></svg>;
  }
  return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="M10 3a7 7 0 0 1 0 14Z" /></svg>;
}

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
          <span className="theme-icon"><ThemeIcon value={option.value} /></span>
          {!compact && <span>{option.label}</span>}
        </button>
      ))}
    </div>
  );
}
