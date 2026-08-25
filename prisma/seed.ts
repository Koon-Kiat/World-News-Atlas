import { PrismaClient, ProviderName } from "@prisma/client";
import { KNOWN_SOURCE_SEEDS } from "../src/config/news-sources";
import { COUNTRY_SIGNALS } from "../src/lib/news/countries/aliases";
import { getCountryName } from "../src/lib/news/countries/metadata";
import { topicLabel } from "../src/lib/news/topics";

const prisma = new PrismaClient();

async function main() {
  for (const country of COUNTRY_SIGNALS) {
    await prisma.country.upsert({
      where: { code: country.code },
      update: { name: getCountryName(country.code) },
      create: { code: country.code, name: getCountryName(country.code) },
    });
  }

  for (const seed of KNOWN_SOURCE_SEEDS) {
    const stored = await prisma.source.upsert({
      where: { domain: seed.domain },
      update: {
        name: seed.name,
        countryCode: seed.countryCode,
        region: seed.region,
        language: seed.language,
        scope: seed.scope,
        qualityScore: seed.qualityScore,
      },
      create: {
        name: seed.name,
        domain: seed.domain,
        countryCode: seed.countryCode,
        region: seed.region,
        language: seed.language,
        scope: seed.scope,
        qualityScore: seed.qualityScore,
      },
    });
    for (const [provider, identifiers] of Object.entries(seed.providerIdentifiers)) {
      for (const identifier of identifiers ?? []) {
        await prisma.sourceProviderIdentifier.upsert({
          where: {
            provider_identifier: {
              provider: provider as ProviderName,
              identifier,
            },
          },
          update: { sourceId: stored.id },
          create: { sourceId: stored.id, provider: provider as ProviderName, identifier },
        });
      }
    }
  }

  for (const slug of [
    "world",
    "politics",
    "business",
    "technology",
    "society",
    "climate",
    "defence",
    "transport",
    "culture",
    "sports",
  ]) {
    await prisma.topic.upsert({
      where: { slug },
      update: { label: topicLabel(slug) },
      create: { slug, label: topicLabel(slug) },
    });
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Database seed failed");
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
