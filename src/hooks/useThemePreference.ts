"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  isThemePreference,
  resolveTheme,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "@/lib/theme";

let memoryTheme: ThemePreference = "system";

function getSnapshot(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemePreference(stored)) {
      memoryTheme = stored;
      return stored;
    }
  } catch {
    return memoryTheme;
  }
  memoryTheme = "system";
  return memoryTheme;
}

function getServerSnapshot(): ThemePreference {
  return "system";
}

function subscribe(onStoreChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) onStoreChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
  };
}

function applyTheme(preference: ThemePreference): void {
  const resolved = resolveTheme(
    preference,
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

export function useThemePreference(): [ThemePreference, (theme: ThemePreference) => void] {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => applyTheme("system");
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [theme]);

  const setTheme = useCallback((value: ThemePreference) => {
    memoryTheme = value;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, value);
    } catch {
      // The in-memory preference still applies for this browser visit.
    }
    applyTheme(value);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }, []);

  return [theme, setTheme];
}
