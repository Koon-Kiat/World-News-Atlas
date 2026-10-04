"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "worldline:search-history:v1";
const MAX_HISTORY_ITEMS = 8;

function readHistory(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, MAX_HISTORY_ITEMS)
      : [];
  } catch {
    return [];
  }
}

export function useSearchHistory() {
  const [history, setHistory] = useState(readHistory);

  useEffect(() => {
    const timer = window.setTimeout(() => setHistory(readHistory()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const add = useCallback((query: string) => {
    const value = query.trim();
    if (!value) return;
    const next = [value, ...readHistory().filter((item) => item.toLocaleLowerCase("en") !== value.toLocaleLowerCase("en"))]
      .slice(0, MAX_HISTORY_ITEMS);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
    catch { /* Search remains usable when browser storage is unavailable. */ }
    setHistory(next);
  }, []);

  const clear = useCallback(() => {
    try { window.localStorage.removeItem(STORAGE_KEY); }
    catch { /* Clear the in-memory list even when persistent storage is blocked. */ }
    setHistory([]);
  }, []);

  return { history, add, clear };
}
