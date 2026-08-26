"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  isNewsPeriod,
  NEWS_PERIOD_STORAGE_KEY,
} from "@/lib/news/periods";
import type { NewsPeriod } from "@/lib/news/types";

const PERIOD_CHANGE_EVENT = "world-news-atlas-period-change";
let memoryPeriod: NewsPeriod = "latest";

function getSnapshot(): NewsPeriod {
  try {
    const stored = window.localStorage.getItem(NEWS_PERIOD_STORAGE_KEY);
    if (isNewsPeriod(stored)) {
      memoryPeriod = stored;
      return stored;
    }
  } catch {
    // Fall back to an in-memory preference for this browser visit.
  }
  return memoryPeriod;
}

function getServerSnapshot(): NewsPeriod {
  return "latest";
}

function subscribe(onStoreChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === NEWS_PERIOD_STORAGE_KEY) onStoreChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(PERIOD_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(PERIOD_CHANGE_EVENT, onStoreChange);
  };
}

export function useNewsPeriodPreference(): [NewsPeriod, (period: NewsPeriod) => void] {
  const period = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setPeriod = useCallback((value: NewsPeriod) => {
    memoryPeriod = value;
    try {
      window.localStorage.setItem(NEWS_PERIOD_STORAGE_KEY, value);
    } catch {
      // The in-memory value still applies for this browser visit.
    }
    window.dispatchEvent(new Event(PERIOD_CHANGE_EVENT));
  }, []);
  return [period, setPeriod];
}
