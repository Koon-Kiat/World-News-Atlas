-- PostgreSQL truncates identifiers to 63 bytes; align the generated index
-- name with Prisma's deterministic shortened identifier.
ALTER INDEX "ProviderIngestionCheckpoint_countryCode_windowStart_windowEnd_i"
  RENAME TO "ProviderIngestionCheckpoint_countryCode_windowStart_windowE_idx";
