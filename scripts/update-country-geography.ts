import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const SOURCE_COMMIT = "9eff32e4eef26715aa59d99b200127d1ef150e7a";
const SOURCE_URL = `https://raw.githubusercontent.com/mledoze/countries/${SOURCE_COMMIT}/countries.json`;

interface SourceCountry {
  cca2: string;
  name: {
    common: string;
    official: string;
    native?: Record<string, { common?: string; official?: string }>;
  };
  capital?: string[];
  altSpellings?: string[];
  languages?: Record<string, string>;
  demonyms?: Record<string, { f?: string; m?: string }>;
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function usefulAlternative(value: string, code: string): boolean {
  const normalized = value.trim();
  return normalized.length > 2 && normalized.toUpperCase() !== code && !/^[A-Z]{2,3}$/.test(normalized);
}

const response = await fetch(SOURCE_URL, {
  headers: { Accept: "application/json", "User-Agent": "WorldNewsAtlas geography updater" },
});
if (!response.ok) throw new Error(`Country geography download failed with HTTP ${response.status}`);

const source = await response.json() as SourceCountry[];
const countries = Object.fromEntries(
  source
    .filter(({ cca2 }) => /^[A-Z]{2}$/.test(cca2))
    .sort((first, second) => first.cca2.localeCompare(second.cca2))
    .map((country) => {
      const nativeNames = Object.values(country.name.native ?? {}).flatMap(({ common, official }) => [common, official]);
      const englishDemonyms = country.demonyms?.eng;
      return [country.cca2, {
        officialNames: unique([country.name.common, country.name.official]),
        nativeNames: unique(nativeNames),
        alternativeNames: unique((country.altSpellings ?? []).filter((value) => usefulAlternative(value, country.cca2))),
        capitals: unique(country.capital ?? []),
        demonyms: unique([englishDemonyms?.f, englishDemonyms?.m]),
        languages: unique(Object.values(country.languages ?? {})),
      }];
    }),
);

const output = {
  source: {
    project: "mledoze/countries",
    commit: SOURCE_COMMIT,
    url: SOURCE_URL,
    license: "ODbL-1.0",
    generatedAt: new Date().toISOString(),
  },
  countries,
};

await writeFile(
  resolve(process.cwd(), "src/data/country-geography.json"),
  `${JSON.stringify(output, null, 2)}\n`,
  "utf8",
);
