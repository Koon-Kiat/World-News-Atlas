import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { listCountries } from "./countries/metadata";
import type { ProviderContinuationState, ProviderCoverageProgress, ProviderName } from "./types";

export type IngestionMode = "incremental" | "backfill";

export interface IngestionCheckpoint {
  provider: ProviderName;
  discoveryKey: string;
  countryCode: string | null;
  language: string | null;
  mode: IngestionMode;
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
  windowStart: string;
  windowEnd: string;
  cursor: ProviderContinuationState | null;
  exhausted: boolean;
  coverageComplete: boolean;
  receivedCount: number;
  acceptedCount: number;
  duplicateCount: number;
  coveredFrom?: string;
  coveredTo?: string;
  lastSuccessfulAt?: string;
}

export interface IngestionStageRecord {
  provider: ProviderName;
  discoveryKey: string;
  countryCode: string | null;
  language: string | null;
  mode: IngestionMode;
  windowStart: Date;
  windowEnd: Date;
}

export interface IngestionStageResult {
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
  cursor: ProviderContinuationState | null;
  exhausted: boolean;
  coverageComplete: boolean;
  receivedCount: number;
  normalizedCount: number;
  acceptedCount: number;
  outOfWindowCount: number;
  irrelevantCount: number;
  duplicateCount: number;
  storedCount: number;
  storiesUpdated: number;
  errorCode?: string;
}

export interface IngestionStateStore {
  load(discoveryKey: string, provider: ProviderName): Promise<IngestionCheckpoint | null>;
  save(checkpoint: IngestionCheckpoint): Promise<void>;
  startStage(stage: IngestionStageRecord): Promise<string | null>;
  finishStage(id: string | null, result: IngestionStageResult): Promise<void>;
  nextCountryBatch(size: number): Promise<string[]>;
}

export const HIGH_VOLUME_COUNTRIES = ["US", "GB", "CN", "JP", "SG", "DE", "FR", "IN", "AU", "CA"] as const;

function rotatingSlice(values: string[], start: number, count: number): string[] {
  if (values.length === 0 || count <= 0) return [];
  return Array.from({ length: Math.min(count, values.length) }, (_, index) =>
    values[(start + index) % values.length]
  );
}

export function countryBatchForRun(runOffset: number, size: number): string[] {
  const countries = listCountries().map(({ code }) => code);
  const highVolume = [...HIGH_VOLUME_COUNTRIES].filter((code) => countries.includes(code));
  const regular = countries.filter((code) => !HIGH_VOLUME_COUNTRIES.includes(code as typeof HIGH_VOLUME_COUNTRIES[number]));
  if (size <= 1) {
    const highVolumeTurn = runOffset % 2 === 0;
    const laneOffset = Math.floor(runOffset / 2);
    return rotatingSlice(highVolumeTurn ? highVolume : regular, laneOffset, 1);
  }
  const highVolumeCount = Math.min(highVolume.length, Math.ceil(size / 2));
  const regularCount = Math.min(regular.length, size - highVolumeCount);
  return [...new Set([
    ...rotatingSlice(highVolume, runOffset * highVolumeCount, highVolumeCount),
    ...rotatingSlice(regular, runOffset * regularCount, regularCount),
  ])];
}

function checkpointFromRecord(record: {
  provider: ProviderName;
  discoveryKey: string;
  countryCode: string | null;
  language: string | null;
  mode: string;
  status: "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED";
  windowStart: Date;
  windowEnd: Date;
  cursor: Prisma.JsonValue | null;
  exhausted: boolean;
  coverageComplete: boolean;
  receivedCount: number;
  acceptedCount: number;
  duplicateCount: number;
  coveredFrom: Date | null;
  coveredTo: Date | null;
  lastSuccessfulAt: Date | null;
}): IngestionCheckpoint {
  return {
    ...record,
    mode: record.mode === "backfill" ? "backfill" : "incremental",
    status: record.status === "SUCCEEDED" || record.status === "FAILED" ? record.status : "PARTIAL",
    windowStart: record.windowStart.toISOString(),
    windowEnd: record.windowEnd.toISOString(),
    cursor: record.cursor && typeof record.cursor === "object" ? record.cursor as ProviderContinuationState : null,
    coveredFrom: record.coveredFrom?.toISOString(),
    coveredTo: record.coveredTo?.toISOString(),
    lastSuccessfulAt: record.lastSuccessfulAt?.toISOString(),
  };
}

export class PrismaIngestionStateStore implements IngestionStateStore {
  constructor(private readonly client: PrismaClient = prisma) {}

  async load(discoveryKey: string, provider: ProviderName): Promise<IngestionCheckpoint | null> {
    const record = await this.client.providerIngestionCheckpoint.findUnique({
      where: { provider_discoveryKey: { provider, discoveryKey } },
    });
    return record ? checkpointFromRecord(record) : null;
  }

  async save(checkpoint: IngestionCheckpoint): Promise<void> {
    const values = {
      countryCode: checkpoint.countryCode,
      language: checkpoint.language,
      mode: checkpoint.mode,
      status: checkpoint.status,
      windowStart: new Date(checkpoint.windowStart),
      windowEnd: new Date(checkpoint.windowEnd),
      coveredFrom: checkpoint.coveredFrom ? new Date(checkpoint.coveredFrom) : null,
      coveredTo: checkpoint.coveredTo ? new Date(checkpoint.coveredTo) : null,
      cursor: checkpoint.cursor ? JSON.parse(JSON.stringify(checkpoint.cursor)) as Prisma.InputJsonValue : Prisma.JsonNull,
      exhausted: checkpoint.exhausted,
      coverageComplete: checkpoint.coverageComplete,
      receivedCount: checkpoint.receivedCount,
      acceptedCount: checkpoint.acceptedCount,
      duplicateCount: checkpoint.duplicateCount,
      lastSuccessfulAt: checkpoint.lastSuccessfulAt ? new Date(checkpoint.lastSuccessfulAt) : null,
    };
    await this.client.providerIngestionCheckpoint.upsert({
      where: { provider_discoveryKey: { provider: checkpoint.provider, discoveryKey: checkpoint.discoveryKey } },
      update: values,
      create: { provider: checkpoint.provider, discoveryKey: checkpoint.discoveryKey, ...values },
    });
  }

  async startStage(stage: IngestionStageRecord): Promise<string> {
    const run = await this.client.providerIngestionRun.create({ data: stage, select: { id: true } });
    return run.id;
  }

  async finishStage(id: string | null, result: IngestionStageResult): Promise<void> {
    if (!id) return;
    await this.client.providerIngestionRun.update({
      where: { id },
      data: {
        status: result.status,
        completedAt: new Date(),
        lastSuccessfulAt: result.status === "FAILED" ? null : new Date(),
        cursor: result.cursor ? JSON.parse(JSON.stringify(result.cursor)) as Prisma.InputJsonValue : Prisma.JsonNull,
        exhausted: result.exhausted,
        coverageComplete: result.coverageComplete,
        receivedCount: result.receivedCount,
        normalizedCount: result.normalizedCount,
        acceptedCount: result.acceptedCount,
        outOfWindowCount: result.outOfWindowCount,
        irrelevantCount: result.irrelevantCount,
        duplicateCount: result.duplicateCount,
        storedCount: result.storedCount,
        storiesUpdated: result.storiesUpdated,
        errorCode: result.errorCode,
      },
    });
  }

  async nextCountryBatch(size: number): Promise<string[]> {
    const scheduler = await this.client.ingestionSchedulerState.upsert({
      where: { id: "country-rotation" },
      update: { lastRunAt: new Date() },
      create: { id: "country-rotation", lastRunAt: new Date() },
    });
    const batch = countryBatchForRun(scheduler.nextCountryOffset, size);
    await this.client.ingestionSchedulerState.update({
      where: { id: "country-rotation" },
      data: { nextCountryOffset: scheduler.nextCountryOffset >= 1_000_000 ? 0 : scheduler.nextCountryOffset + 1 },
    });
    return batch;
  }
}

export class MemoryIngestionStateStore implements IngestionStateStore {
  private readonly checkpoints = new Map<string, IngestionCheckpoint>();
  private offset = 0;
  load(discoveryKey: string, provider: ProviderName): Promise<IngestionCheckpoint | null> {
    return Promise.resolve(this.checkpoints.get(`${provider}:${discoveryKey}`) ?? null);
  }
  save(checkpoint: IngestionCheckpoint): Promise<void> {
    this.checkpoints.set(`${checkpoint.provider}:${checkpoint.discoveryKey}`, structuredClone(checkpoint));
    return Promise.resolve();
  }
  startStage(): Promise<null> { return Promise.resolve(null); }
  finishStage(): Promise<void> { return Promise.resolve(); }
  nextCountryBatch(size: number): Promise<string[]> {
    const batch = countryBatchForRun(this.offset, size);
    this.offset = this.offset >= 1_000_000 ? 0 : this.offset + 1;
    return Promise.resolve(batch);
  }
}

export function discoveryKeyFor(input: { mode: IngestionMode; countryCode: string | null; period: string; language?: string | null }): string {
  return [input.mode, input.countryCode ?? "global", input.period, input.language ?? "all"].join(":");
}

export function mergeCoverage(current: IngestionCheckpoint | null, progress: ProviderCoverageProgress | undefined): Pick<IngestionCheckpoint, "coveredFrom" | "coveredTo" | "coverageComplete"> {
  const candidatesFrom = [current?.coveredFrom, progress?.coveredFrom].filter(Boolean) as string[];
  const candidatesTo = [current?.coveredTo, progress?.coveredTo].filter(Boolean) as string[];
  return {
    coveredFrom: candidatesFrom.sort()[0],
    coveredTo: candidatesTo.sort().at(-1),
    coverageComplete: Boolean(current?.coverageComplete || progress?.timeRangeCovered),
  };
}
