-- Extend ingestion runs so they describe the discovery shard and publication window.
ALTER TABLE "ProviderIngestionRun"
  ADD COLUMN "discoveryKey" TEXT NOT NULL DEFAULT 'global',
  ADD COLUMN "countryCode" CHAR(2),
  ADD COLUMN "language" VARCHAR(12),
  ADD COLUMN "mode" VARCHAR(24) NOT NULL DEFAULT 'incremental',
  ADD COLUMN "windowStart" TIMESTAMP(3),
  ADD COLUMN "windowEnd" TIMESTAMP(3),
  ADD COLUMN "cursor" JSONB,
  ADD COLUMN "exhausted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "coverageComplete" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lastSuccessfulAt" TIMESTAMP(3),
  ADD COLUMN "acceptedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "outOfWindowCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "irrelevantCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "ProviderIngestionRun_provider_discoveryKey_startedAt_idx"
  ON "ProviderIngestionRun"("provider", "discoveryKey", "startedAt" DESC);
CREATE INDEX "ProviderIngestionRun_countryCode_windowStart_windowEnd_idx"
  ON "ProviderIngestionRun"("countryCode", "windowStart", "windowEnd");

CREATE TABLE "ProviderIngestionCheckpoint" (
  "id" TEXT NOT NULL,
  "provider" "ProviderName" NOT NULL,
  "discoveryKey" TEXT NOT NULL,
  "countryCode" CHAR(2),
  "language" VARCHAR(12),
  "mode" VARCHAR(24) NOT NULL DEFAULT 'incremental',
  "status" "IngestionStatus" NOT NULL DEFAULT 'RUNNING',
  "windowStart" TIMESTAMP(3) NOT NULL,
  "windowEnd" TIMESTAMP(3) NOT NULL,
  "coveredFrom" TIMESTAMP(3),
  "coveredTo" TIMESTAMP(3),
  "cursor" JSONB,
  "exhausted" BOOLEAN NOT NULL DEFAULT false,
  "coverageComplete" BOOLEAN NOT NULL DEFAULT false,
  "receivedCount" INTEGER NOT NULL DEFAULT 0,
  "acceptedCount" INTEGER NOT NULL DEFAULT 0,
  "duplicateCount" INTEGER NOT NULL DEFAULT 0,
  "lastSuccessfulAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderIngestionCheckpoint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderIngestionCheckpoint_provider_discoveryKey_key"
  ON "ProviderIngestionCheckpoint"("provider", "discoveryKey");
CREATE INDEX "ProviderIngestionCheckpoint_countryCode_windowStart_windowEnd_idx"
  ON "ProviderIngestionCheckpoint"("countryCode", "windowStart", "windowEnd");
CREATE INDEX "ProviderIngestionCheckpoint_status_updatedAt_idx"
  ON "ProviderIngestionCheckpoint"("status", "updatedAt");

CREATE TABLE "IngestionSchedulerState" (
  "id" TEXT NOT NULL,
  "nextCountryOffset" INTEGER NOT NULL DEFAULT 0,
  "lastRunAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IngestionSchedulerState_pkey" PRIMARY KEY ("id")
);
