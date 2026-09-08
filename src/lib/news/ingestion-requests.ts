import type { IngestionSummary } from "./ingest";

export const INGESTION_LEASE_MS = 180_000;
export const INGESTION_RECORD_TTL_MS = 7 * 24 * 60 * 60_000;
export type IngestionRequestState = "RUNNING" | "SUCCEEDED" | "FAILED";
export type IngestionClaim = { state: IngestionRequestState | "ACCEPTED" | "BUSY" | "CONFLICT"; summary?: IngestionSummary };
export interface IngestionRequestStore {
  claim(id: string, digest: string, now: Date): Promise<IngestionClaim>;
  renew(id: string, now: Date): Promise<boolean>;
  finish(id: string, state: "SUCCEEDED" | "FAILED", summary: IngestionSummary | null, now: Date): Promise<void>;
}

export class D1IngestionRequestStore implements IngestionRequestStore {
  constructor(private readonly database: D1Database) {}

  async claim(id: string, digest: string, now: Date): Promise<IngestionClaim> {
    const at = now.getTime();
    const lease = at + INGESTION_LEASE_MS;
    const results = await this.database.batch([
      this.database.prepare(`DELETE FROM ingestion_logical_request WHERE request_id IN
        (SELECT request_id FROM ingestion_logical_request WHERE expires_at <= ? ORDER BY expires_at LIMIT 250)`).bind(at),
      this.database.prepare(`UPDATE ingestion_logical_request SET state = 'FAILED', updated_at = ?
        WHERE state = 'RUNNING' AND lease_until <= ?`).bind(at, at),
      this.database.prepare(`INSERT OR IGNORE INTO ingestion_operation_lock (id, request_id, lease_until)
        VALUES ('production', '', 0)`),
      this.database.prepare(`UPDATE ingestion_operation_lock SET request_id = ?, lease_until = ?
        WHERE id = 'production' AND lease_until <= ?
        AND NOT EXISTS (SELECT 1 FROM ingestion_logical_request WHERE request_id = ?)`).bind(id, lease, at, id),
      this.database.prepare(`INSERT OR IGNORE INTO ingestion_logical_request
        (request_id, body_digest, state, summary_json, lease_until, expires_at, updated_at)
        SELECT ?, ?, 'RUNNING', NULL, ?, ?, ? FROM ingestion_operation_lock
        WHERE id = 'production' AND request_id = ? AND lease_until = ?`).bind(id, digest, lease, at + INGESTION_RECORD_TTL_MS, at, id, lease),
      this.database.prepare(`SELECT body_digest, state, summary_json FROM ingestion_logical_request WHERE request_id = ?`).bind(id),
    ]);
    const row = results[5].results[0] as { body_digest: string; state: IngestionRequestState; summary_json: string | null } | undefined;
    if (!row) return { state: "BUSY" };
    if (row.body_digest !== digest) return { state: "CONFLICT" };
    if (results[4].meta.changes === 1) return { state: "ACCEPTED" };
    return { state: row.state, ...(row.summary_json ? { summary: JSON.parse(row.summary_json) as IngestionSummary } : {}) };
  }

  async renew(id: string, now: Date): Promise<boolean> {
    const at = now.getTime();
    const lease = at + INGESTION_LEASE_MS;
    const results = await this.database.batch([
      this.database.prepare(`UPDATE ingestion_operation_lock SET lease_until = ?
        WHERE id = 'production' AND request_id = ? AND lease_until > ?`).bind(lease, id, at),
      this.database.prepare(`UPDATE ingestion_logical_request SET lease_until = ?, updated_at = ?
        WHERE request_id = ? AND state = 'RUNNING' AND lease_until > ?
        AND EXISTS (SELECT 1 FROM ingestion_operation_lock WHERE id = 'production' AND request_id = ? AND lease_until = ?)`).bind(lease, at, id, at, id, lease),
    ]);
    return results[0].meta.changes === 1 && results[1].meta.changes === 1;
  }

  async finish(id: string, state: "SUCCEEDED" | "FAILED", summary: IngestionSummary | null, now: Date): Promise<void> {
    const results = await this.database.batch([
      this.database.prepare(`UPDATE ingestion_logical_request SET state = ?, summary_json = ?, updated_at = ?
        WHERE request_id = ? AND state = 'RUNNING' AND lease_until > ?
        AND EXISTS (SELECT 1 FROM ingestion_operation_lock WHERE id = 'production' AND request_id = ? AND lease_until > ?)`)
        .bind(state, summary ? JSON.stringify(summary) : null, now.getTime(), id, now.getTime(), id, now.getTime()),
      this.database.prepare(`UPDATE ingestion_operation_lock SET lease_until = 0 WHERE id = 'production' AND request_id = ?`).bind(id),
    ]);
    if (results[0].meta.changes !== 1) throw new Error("Ingestion lease was lost");
  }
}
