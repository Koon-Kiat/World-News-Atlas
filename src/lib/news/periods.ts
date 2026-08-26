import type { NewsPeriod } from "./types";

export const NEWS_PERIOD_STORAGE_KEY = "world-news-atlas-period";

export const NEWS_PERIOD_OPTIONS: ReadonlyArray<{
  value: NewsPeriod;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    value: "24h",
    label: "Past 24 hours",
    shortLabel: "24 hours",
    description: "The fastest-moving headlines and breaking developments.",
  },
  {
    value: "latest",
    label: "Past 3 days",
    shortLabel: "3 days",
    description: "A balanced current briefing with enough time for developing stories.",
  },
  {
    value: "7d",
    label: "Past 7 days",
    shortLabel: "7 days",
    description: "A wider weekly view for countries with less frequent coverage.",
  },
  {
    value: "30d",
    label: "Past 30 days",
    shortLabel: "30 days",
    description: "The broadest available range for deeper country exploration.",
  },
];

export function isNewsPeriod(value: string | null): value is NewsPeriod {
  return NEWS_PERIOD_OPTIONS.some((option) => option.value === value);
}

export function newsPeriodHours(period: NewsPeriod): number {
  if (period === "24h") return 24;
  if (period === "7d") return 168;
  if (period === "30d") return 720;
  return 72;
}

export function newsPeriodLabel(period: NewsPeriod): string {
  return NEWS_PERIOD_OPTIONS.find((option) => option.value === period)?.label ?? "Past 3 days";
}
