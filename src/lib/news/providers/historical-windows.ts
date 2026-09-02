import type { NewsPeriod } from "../types";

export interface HistoricalDiscoveryWindow {
  from?: Date;
  to?: Date;
  index: number;
}

export function historicalDiscoveryWindows(options: {
  from?: Date;
  to?: Date;
  period?: NewsPeriod;
}): HistoricalDiscoveryWindow[] {
  if (!options.from || !options.to) {
    return [{ from: options.from, to: options.to, index: 0 }];
  }
  const windowCount = options.period === "30d" ? 6 : options.period === "7d" ? 3 : 1;
  if (windowCount === 1) {
    return [{ from: options.from, to: options.to, index: 0 }];
  }

  const start = options.from.getTime();
  const end = options.to.getTime();
  const chronological = Array.from({ length: windowCount }, (_, index) => ({
    from: new Date(start + (end - start) * index / windowCount),
    to: new Date(start + (end - start) * (index + 1) / windowCount),
    index,
  }));
  const priority = [
    windowCount - 1,
    Math.floor((windowCount - 1) / 2),
    0,
    ...Array.from({ length: windowCount }, (_, index) => index),
  ];
  return [...new Set(priority)].map((index) => chronological[index]);
}
