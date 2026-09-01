import nextEnv from "@next/env";
import { loadNewsDataset, resetLiveCorpusForTesting } from "../src/lib/news/data-store";
import {
  gdeltModeFromEnvironment,
  rssFeedsFromEnvironment,
  shouldEnableGdelt,
} from "../src/lib/news/providers";
import { buildNewsResponse, DEFAULT_NEWS_QUERY } from "../src/lib/news/query";
import { parseNewsCliOptions } from "./news-cli-options";

nextEnv.loadEnvConfig(process.cwd());
if (process.argv.includes("--quiet")) process.env.NEWS_DIAGNOSTIC_QUIET = "true";

async function diagnose(): Promise<void> {
  const options = parseNewsCliOptions("30d");
  const country = options.countries?.[0] ?? "US";
  const maxStages = options.stageLimit ?? 12;
  const query = { ...DEFAULT_NEWS_QUERY, countries: [country], period: options.period, page: 1 };
  resetLiveCorpusForTesting();
  let dataset = await loadNewsDataset(query);
  for (let stage = 1; stage < maxStages && !dataset.corpusComplete; stage += 1) {
    dataset = await loadNewsDataset({ ...query, page: Math.min(100, Math.max(1, Math.ceil(dataset.stories.length / query.pageSize))) });
  }
  const response = buildNewsResponse(dataset.stories, query, dataset.dataSource, dataset.notice, dataset);
  const clusters = dataset.stories.map(({ articles }) => articles.length);
  const configuredRssFeedCount = rssFeedsFromEnvironment().length;
  const report = {
    selectedCountry: country,
    period: options.period,
    dataSource: dataset.dataSource,
    providerConfiguration: [
      { provider: "Bing News RSS", health: "enabled" },
      {
        provider: "NewsAPI",
        health: process.env.NEWSAPI_KEY?.trim() ? "enabled" : "missing_credential",
      },
      {
        provider: "GDELT",
        health: shouldEnableGdelt({ period: options.period, countries: [country] }) ? "enabled" : "disabled",
        mode: gdeltModeFromEnvironment(),
      },
      {
        provider: "RSS",
        health: configuredRssFeedCount > 0 ? "enabled" : "disabled",
        feedCount: configuredRssFeedCount,
      },
    ],
    providers: response.meta.diagnostics?.providerContributions.map((provider) => ({
      provider: provider.provider === "OTHER" ? "BING" : provider.provider,
      health: provider.health,
      plansAttempted: provider.plansAttempted,
      plansCompleted: provider.plansCompleted,
      received: provider.received,
      accepted: provider.accepted,
      countryIrrelevant: provider.countryIrrelevant,
      outOfWindow: provider.outOfWindow,
      duplicates: provider.duplicates,
      markets: provider.markets,
      languages: provider.languages,
      countryQueries: provider.countryQueries,
      archiveWindowStart: provider.archiveWindowStart,
      archiveWindowEnd: provider.archiveWindowEnd,
      archiveCoveredFrom: provider.archiveCoveredFrom,
      exhaustionReason: provider.exhaustionReason,
    })) ?? [],
    final: {
      rawArticles: response.meta.diagnostics?.rawArticleCount ?? dataset.articleCount,
      relevantArticles: response.meta.diagnostics?.relevantArticleCount ?? dataset.articleCount,
      duplicateArticles: response.meta.diagnostics?.duplicateArticleCount ?? 0,
      storyClusters: response.meta.materializedStoryCount,
      largestCluster: clusters.length > 0 ? Math.max(...clusters) : 0,
      discoveryExhausted: response.meta.discoveryExhausted,
      archiveCoverageComplete: response.meta.archiveCoverageComplete,
      coverageComplete: response.meta.coverageComplete,
      coverageStatus: response.meta.coverageStatus,
      coverageReasons: response.meta.coverageReasons,
      corpusLimitReached: response.meta.corpusLimitReached,
    },
  };
  console.info(JSON.stringify({ event: process.argv.includes("--smoke") ? "coverage_smoke" : "coverage_diagnostic", ...report }, null, 2));
}

diagnose().catch((error) => {
  console.error(JSON.stringify({
    event: "coverage_diagnostic_failed",
    code: error instanceof Error ? error.name : "UNEXPECTED_FAILURE",
    message: "Coverage diagnostics could not complete. Check provider configuration and server logs.",
  }));
  process.exitCode = 1;
});
