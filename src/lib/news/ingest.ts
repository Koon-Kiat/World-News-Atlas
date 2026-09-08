import { queryRelevantArticles } from "./acceptance";
import { clusterArticlesHybrid } from "./cluster";
import { buildCountryDiscoveryQuery } from "./countries/discovery";
import { deduplicateArticles } from "./deduplicate";
import {
  discoveryKeyFor,
  MemoryIngestionStateStore,
  mergeCoverage,
  type IngestionMode,
  type IngestionStateStore,
} from "./ingestion-state";
import { getConfiguredNewsStore } from "./configured-store";
import { logNews } from "./logger";
import { normalizeProviderArticles } from "./normalize";
import { newsPeriodHours } from "./periods";
import { persistStoryCandidates } from "./persistence";
import { createConfiguredProviders, fetchProviderArticlesGracefully } from "./providers";
import type { NewsProvider } from "./providers/provider";
import type { NewsStore } from "./store";
import type { NewsPeriod, NewsQuery, ProviderContinuationState, ProviderName } from "./types";

const DEFAULT_STAGE_LIMIT = 24;
const DEFAULT_COUNTRY_BATCH_SIZE = 8;
const STAGE_ARTICLE_LIMIT = 96;

export interface IngestionSummary {
  runId: string;
  mode: IngestionMode;
  period: NewsPeriod;
  countries: string[];
  stagesProcessed: number;
  providersAttempted: number;
  providersFailed: number;
  providerFailures?: Array<{ provider: ProviderName; code: string }>;
  received: number;
  normalized: number;
  articlesWithCountries: number;
  countryDetectionRate: number;
  accepted: number;
  outOfWindow: number;
  countryIrrelevant: number;
  rejected: number;
  duplicatesRemoved: number;
  stored: number;
  storiesUpdated: number;
  persisted: boolean;
  budgetExhausted: boolean;
  checkpointsCompleted: number;
  durationMs: number;
}

export interface NewsIngestionOptions {
  providers?: NewsProvider[];
  persist?: boolean;
  stateStore?: IngestionStateStore;
  store?: NewsStore;
  mode?: IngestionMode;
  period?: NewsPeriod;
  countries?: string[];
  stageLimit?: number;
  countryBatchSize?: number;
  snapshotTo?: Date;
  beforeWork?: () => Promise<void>;
  onPlan?: (plan: IngestionPlan) => Promise<void>;
  onTerminalFailure?: () => Promise<void>;
}

export interface IngestionPlan {
  snapshotTo: string;
  countries: string[];
}

function boundedNumber(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, Math.floor(value!))) : fallback;
}

export function ingestionCountryBatchSize(
  requestedSize: number,
  stageLimit: number,
  providerCount: number,
): number {
  return Math.min(
    requestedSize,
    Math.max(1, Math.floor(stageLimit / Math.max(1, providerCount))),
  );
}

function queryFor(countryCode: string | null, period: NewsPeriod): NewsQuery {
  return {
    countries: countryCode ? [countryCode] : [],
    sourcePerspective: "all",
    sources: [],
    period,
    sort: "newest",
    page: 1,
    pageSize: 12,
  };
}

function checkpointCoversWindow(
  checkpoint: Awaited<ReturnType<IngestionStateStore["load"]>>,
  windowStart: Date,
  windowEnd: Date,
): boolean {
  if (!checkpoint || checkpoint.status === "FAILED" || (!checkpoint.coverageComplete && !checkpoint.exhausted)) return false;
  return new Date(checkpoint.windowStart).getTime() <= windowStart.getTime() &&
    new Date(checkpoint.windowEnd).getTime() >= windowEnd.getTime();
}

export function terminalIngestionFailure(code: string | undefined): boolean {
  if (!code) return false;
  if (code === "PROVIDER_LIMIT" || code === "MISSING_CREDENTIAL") return true;
  const status = Number(code.match(/^HTTP_(\d{3})$/)?.[1]);
  return Number.isInteger(status) && status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status);
}

function extendedWindow(
  checkpoint: NonNullable<Awaited<ReturnType<IngestionStateStore["load"]>>>,
  requestedStart: Date,
  requestedEnd: Date,
): { from: Date; to: Date } {
  const priorStart = new Date(checkpoint.windowStart);
  const priorEnd = new Date(checkpoint.windowEnd);
  if (priorEnd.getTime() < requestedEnd.getTime() && priorEnd.getTime() >= requestedStart.getTime()) {
    return { from: priorEnd, to: requestedEnd };
  }
  if (requestedStart.getTime() < priorStart.getTime() && priorStart.getTime() <= requestedEnd.getTime()) {
    return { from: requestedStart, to: priorStart };
  }
  return { from: requestedStart, to: requestedEnd };
}

export async function runNewsIngestion(options: NewsIngestionOptions = {}): Promise<IngestionSummary> {
  const startedAt = Date.now();
  const mode = options.mode ?? "incremental";
  const period = options.period ?? (mode === "backfill" ? "30d" : "latest");
  const snapshotTo = options.snapshotTo ?? new Date();
  const snapshotFrom = new Date(snapshotTo.getTime() - newsPeriodHours(period) * 3_600_000);
  const store = options.store ?? (options.persist === false ? null : await getConfiguredNewsStore());
  const shouldPersist = options.persist ?? Boolean(store);
  if (shouldPersist && !store) throw new Error("D1 persistence was requested but the Sites DB binding is unavailable");
  const stateStore = options.stateStore ?? store ?? new MemoryIngestionStateStore();
  const stageLimit = boundedNumber(options.stageLimit ?? Number(process.env.NEWS_INGESTION_STAGE_LIMIT), DEFAULT_STAGE_LIMIT, 1, 200);
  const countryBatchSize = boundedNumber(options.countryBatchSize ?? Number(process.env.NEWS_INGESTION_COUNTRY_BATCH_SIZE), DEFAULT_COUNTRY_BATCH_SIZE, 1, 40);
  const providersForAllShards = options.providers ?? createConfiguredProviders({ period, countries: ["US"] });
  const effectiveCountryBatchSize = ingestionCountryBatchSize(
    countryBatchSize,
    stageLimit,
    providersForAllShards.length,
  );
  const countries = options.countries !== undefined
    ? [...new Set(options.countries.map((code) => code.toUpperCase()))]
    : options.providers ? [] : await stateStore.nextCountryBatch(effectiveCountryBatchSize);
  const shards: Array<string | null> = countries.length > 0 ? countries : [null];
  // Persist the resolved scope/window before any provider or story writes.
  // A transport retry then resumes these checkpoints, not the next rotation.
  await options.beforeWork?.();
  await options.onPlan?.({ snapshotTo: snapshotTo.toISOString(), countries });
  const summary: IngestionSummary = {
    runId: crypto.randomUUID(),
    mode,
    period,
    countries,
    stagesProcessed: 0,
    providersAttempted: 0,
    providersFailed: 0,
    providerFailures: [],
    received: 0,
    normalized: 0,
    articlesWithCountries: 0,
    countryDetectionRate: 0,
    accepted: 0,
    outOfWindow: 0,
    countryIrrelevant: 0,
    rejected: 0,
    duplicatesRemoved: 0,
    stored: 0,
    storiesUpdated: 0,
    persisted: shouldPersist,
    budgetExhausted: false,
    checkpointsCompleted: 0,
    durationMs: 0,
  };
  const seenCanonicalUrls = new Set<string>();
  logNews("info", "ingestion_started", { mode, period, countries, stageLimit });

  outer: for (const countryCode of shards) {
    const providers = providersForAllShards;
    for (const provider of providers) {
      summary.providersAttempted += 1;
      const discoveryKey = discoveryKeyFor({ mode, countryCode, period });
      const prior = await stateStore.load(discoveryKey, provider.name);
      if (checkpointCoversWindow(prior, snapshotFrom, snapshotTo)) {
        summary.checkpointsCompleted += 1;
        continue;
      }
      const reusable = prior && !prior.coverageComplete && !prior.exhausted;
      const requestedWindow = prior && !reusable
        ? extendedWindow(prior, snapshotFrom, snapshotTo)
        : { from: snapshotFrom, to: snapshotTo };
      const providerWindowStart = reusable ? new Date(prior.windowStart) : requestedWindow.from;
      const providerWindowEnd = reusable ? new Date(prior.windowEnd) : requestedWindow.to;
      if (providerWindowStart.getTime() >= providerWindowEnd.getTime()) {
        summary.checkpointsCompleted += 1;
        continue;
      }
      let continuation: ProviderContinuationState | null = reusable ? prior.cursor : null;
      let exhausted = false;
      let coverageComplete = false;
      let checkpoint = reusable
        ? prior
        : prior
          ? { ...prior, cursor: null, exhausted: false, coverageComplete: false }
          : null;
      const checkpointWindowStart = prior
        ? new Date(Math.min(new Date(prior.windowStart).getTime(), providerWindowStart.getTime()))
        : providerWindowStart;
      const checkpointWindowEnd = prior
        ? new Date(Math.max(new Date(prior.windowEnd).getTime(), providerWindowEnd.getTime()))
        : providerWindowEnd;
      let providerStages = 0;
      const providerStageBudget = Math.max(
        1,
        Math.floor(stageLimit / Math.max(1, shards.length * providers.length)),
      );

      while (!exhausted && !coverageComplete) {
        await options.beforeWork?.();
        if (summary.stagesProcessed >= stageLimit || providerStages >= providerStageBudget) {
          if (summary.stagesProcessed >= stageLimit) summary.budgetExhausted = true;
          if (summary.stagesProcessed >= stageLimit) break outer;
          break;
        }
        const stageId = await stateStore.startStage({
          provider: provider.name,
          discoveryKey,
          countryCode,
          language: null,
          mode,
          windowStart: providerWindowStart,
          windowEnd: providerWindowEnd,
        });
        const request = {
          from: providerWindowStart,
          to: providerWindowEnd,
          countries: countryCode ? [countryCode] : [],
          period,
          sourcePerspective: "all" as const,
          limit: STAGE_ARTICLE_LIMIT,
          continuation: continuation ?? undefined,
        };
        const search = countryCode ? buildCountryDiscoveryQuery([countryCode]) : undefined;
        const batch = await fetchProviderArticlesGracefully([provider], search && provider.name !== "RSS" ? { ...request, query: search } : request, {
          deadlineMs: 32_000, ignoreCachedFailures: true,
        });
        await options.beforeWork?.();
        if (batch.failures.some((failure) => terminalIngestionFailure(failure.code))) {
          await options.onTerminalFailure?.();
        }
        summary.stagesProcessed += 1;
        providerStages += 1;
        summary.providersFailed += batch.failures.length;
        summary.providerFailures?.push(...batch.failures);
        const rawReceived = batch.providerDiagnostics[provider.name]?.received ?? batch.articles.length;
        summary.received += rawReceived;
        let rejected = 0;
        const normalized = normalizeProviderArticles(batch.articles, () => { rejected += 1; });
        summary.normalized += normalized.length;
        summary.rejected += rejected;
        summary.articlesWithCountries += normalized.filter(({ countries: detected }) => detected.length > 0).length;
        const relevant = queryRelevantArticles(normalized, queryFor(countryCode, period), providerWindowStart, providerWindowEnd);
        summary.outOfWindow += relevant.rejected.out_of_window;
        summary.countryIrrelevant += relevant.rejected.country_irrelevant;
        const runUnique = relevant.accepted.filter(({ canonicalUrl }) => !seenCanonicalUrls.has(canonicalUrl));
        const deduplicated = deduplicateArticles(runUnique);
        deduplicated.articles.forEach(({ canonicalUrl }) => seenCanonicalUrls.add(canonicalUrl));
        summary.accepted += deduplicated.articles.length;
        summary.duplicatesRemoved += relevant.accepted.length - deduplicated.articles.length + deduplicated.duplicateCount;

        let stored = 0;
        let storiesUpdated = 0;
        if (shouldPersist && deduplicated.articles.length > 0) {
          const result = await persistStoryCandidates(await clusterArticlesHybrid(deduplicated.articles), store!, options.beforeWork);
          stored = result.storedArticles;
          storiesUpdated = result.storiesUpdated;
          summary.stored += stored;
          summary.storiesUpdated += storiesUpdated;
        }

        continuation = batch.continuations[provider.name] ?? (batch.failures.length ? continuation : null);
        exhausted = batch.exhaustedProviders.includes(provider.name);
        const stageFailure = batch.failures[0];
        if (terminalIngestionFailure(stageFailure?.code)) exhausted = true;
        const mergedCoverage = mergeCoverage(checkpoint, batch.providerCoverage[provider.name]);
        coverageComplete = mergedCoverage.coverageComplete;
        checkpoint = {
          provider: provider.name,
          discoveryKey,
          countryCode,
          language: null,
          mode,
          status: stageFailure
            ? terminalIngestionFailure(stageFailure.code) ? "PARTIAL" : "FAILED"
            : exhausted || coverageComplete ? "SUCCEEDED" : "PARTIAL",
          windowStart: checkpointWindowStart.toISOString(),
          windowEnd: checkpointWindowEnd.toISOString(),
          cursor: continuation,
          exhausted,
          coverageComplete,
          receivedCount: (checkpoint?.receivedCount ?? 0) + rawReceived,
          acceptedCount: (checkpoint?.acceptedCount ?? 0) + deduplicated.articles.length,
          duplicateCount: (checkpoint?.duplicateCount ?? 0) + relevant.accepted.length - deduplicated.articles.length,
          coveredFrom: mergedCoverage.coveredFrom,
          coveredTo: mergedCoverage.coveredTo,
          lastSuccessfulAt: batch.failures.length === 0 ? new Date().toISOString() : checkpoint?.lastSuccessfulAt,
        };
        await options.beforeWork?.();
        await stateStore.save(checkpoint);
        if (coverageComplete || exhausted) summary.checkpointsCompleted += 1;
        await stateStore.finishStage(stageId, {
          status: stageFailure ? "FAILED" : exhausted || coverageComplete ? "SUCCEEDED" : "PARTIAL",
          cursor: continuation,
          exhausted,
          coverageComplete,
          receivedCount: rawReceived,
          normalizedCount: normalized.length,
          acceptedCount: deduplicated.articles.length,
          outOfWindowCount: relevant.rejected.out_of_window,
          irrelevantCount: relevant.rejected.country_irrelevant,
          duplicateCount: relevant.accepted.length - deduplicated.articles.length,
          storedCount: stored,
          storiesUpdated,
          errorCode: stageFailure?.code,
        });
        if (batch.failures.length > 0 || !continuation) exhausted = true;
      }
    }
  }

  summary.countryDetectionRate = summary.normalized === 0 ? 0 : Number((summary.articlesWithCountries / summary.normalized).toFixed(3));
  summary.durationMs = Date.now() - startedAt;
  logNews("info", "ingestion_completed", { ...summary });
  return summary;
}
