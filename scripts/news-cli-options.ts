import { normalizeCountryCode } from "../src/lib/news/countries/metadata";
import type { NewsPeriod } from "../src/lib/news/types";

function valueFor(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export function parseNewsCliOptions(defaultPeriod: NewsPeriod): {
  countries?: string[];
  period: NewsPeriod;
  stageLimit?: number;
} {
  const countryValue = valueFor("country");
  const country = countryValue ? normalizeCountryCode(countryValue) : null;
  if (countryValue && !country) throw new Error("--country must be a valid ISO 3166-1 alpha-2 code");
  const periodValue = valueFor("period") ?? defaultPeriod;
  if (!["24h", "latest", "7d", "30d"].includes(periodValue)) {
    throw new Error("--period must be one of 24h, latest, 7d, or 30d");
  }
  const rawStageLimit = valueFor("stages") ?? valueFor("max-stages");
  const stageLimit = rawStageLimit ? Number(rawStageLimit) : undefined;
  if (stageLimit !== undefined && (!Number.isInteger(stageLimit) || stageLimit < 1 || stageLimit > 200)) {
    throw new Error("--stages must be an integer between 1 and 200");
  }
  return { countries: country ? [country] : undefined, period: periodValue as NewsPeriod, stageLimit };
}
