import type { IngestionPlan, IngestionSummary } from "./ingest";

export const INGESTION_LEASE_MS = 180_000;
export const INGESTION_RECORD_TTL_MS = 7 * 24 * 60 * 60_000;
export const MAX_INGESTION_ATTEMPTS = 3;
export type IngestionRequestState = "RUNNING" | "SUCCEEDED" | "FAILED_RETRYABLE" | "FAILED_TERMINAL";
type FinishedState = Exclude<IngestionRequestState, "RUNNING">;
export type IngestionClaim =
  | { state: "ACCEPTED"; token: string; plan?: IngestionPlan }
  | { state: Exclude<IngestionRequestState, "FAILED_RETRYABLE"> | "BUSY" | "CONFLICT"; summary?: IngestionSummary };
export interface IngestionRequestStore {
  claim(id: string, digest: string, now: Date): Promise<IngestionClaim>;
  renew(id: string, token: string, now: Date): Promise<boolean>;
  savePlan(id: string, token: string, plan: IngestionPlan, now: Date): Promise<void>;
  markTerminalFailure(id: string, token: string, now: Date): Promise<void>;
  finish(id: string, token: string, state: FinishedState, summary: IngestionSummary | null, now: Date): Promise<FinishedState>;
}

export class D1IngestionRequestStore implements IngestionRequestStore {
  constructor(private readonly database: D1Database) {}

  async claim(id: string, digest: string, now: Date): Promise<IngestionClaim> {
    const at = now.getTime();
    const lease = at + INGESTION_LEASE_MS;
    const token = crypto.randomUUID();
    const results = await this.database.batch([
      this.database.prepare(`DELETE FROM ingestion_logical_request WHERE request_id IN
        (SELECT request_id FROM ingestion_logical_request WHERE expires_at <= ? ORDER BY expires_at LIMIT 250)`).bind(at),
      // Legacy workers did not pin their plan or carry a fencing token: do not
      // reinterpret their FAILED records or expired work as safely resumable.
      this.database.prepare(`UPDATE ingestion_logical_request SET state = CASE
        WHEN attempts = 0 OR attempts >= ? OR terminal_failure = 1 THEN 'FAILED_TERMINAL' ELSE 'FAILED_RETRYABLE' END, updated_at = ?
        WHERE state = 'RUNNING' AND lease_until <= ?`).bind(MAX_INGESTION_ATTEMPTS, at, at),
      this.database.prepare(`INSERT OR IGNORE INTO ingestion_operation_lock (id, request_id, lease_until, attempt_token)
        VALUES ('production', '', 0, '')`),
      this.database.prepare(`UPDATE ingestion_operation_lock SET request_id = ?, lease_until = ?, attempt_token = ?
        WHERE id = 'production' AND lease_until <= ? AND (
          NOT EXISTS (SELECT 1 FROM ingestion_logical_request WHERE request_id = ?) OR
          EXISTS (SELECT 1 FROM ingestion_logical_request WHERE request_id = ? AND body_digest = ?
            AND state = 'FAILED_RETRYABLE' AND attempts < ? AND terminal_failure = 0))`)
        .bind(id, lease, token, at, id, id, digest, MAX_INGESTION_ATTEMPTS),
      this.database.prepare(`INSERT OR IGNORE INTO ingestion_logical_request
        (request_id, body_digest, state, summary_json, lease_until, expires_at, updated_at, attempts, attempt_token)
        SELECT ?, ?, 'RUNNING', NULL, ?, ?, ?, 1, ? FROM ingestion_operation_lock
        WHERE id = 'production' AND attempt_token = ?`).bind(id, digest, lease, at + INGESTION_RECORD_TTL_MS, at, token, token),
      this.database.prepare(`UPDATE ingestion_logical_request SET state = 'RUNNING', attempts = attempts + 1,
        attempt_token = ?, lease_until = ?, updated_at = ?
        WHERE request_id = ? AND state = 'FAILED_RETRYABLE'
        AND EXISTS (SELECT 1 FROM ingestion_operation_lock WHERE id = 'production' AND attempt_token = ?)`)
        .bind(token, lease, at, id, token),
      this.database.prepare(`SELECT body_digest, state, summary_json, attempt_token, plan_json
        FROM ingestion_logical_request WHERE request_id = ?`).bind(id),
    ]);
    const row = results[6].results[0] as { body_digest: string; state: IngestionRequestState | "FAILED"; summary_json: string | null; attempt_token: string; plan_json: string | null } | undefined;
    if (!row) return { state: "BUSY" };
    if (row.body_digest !== digest) return { state: "CONFLICT" };
    if (row.attempt_token === token) return { state: "ACCEPTED", token, ...(row.plan_json ? { plan: JSON.parse(row.plan_json) as IngestionPlan } : {}) };
    if (row.state === "FAILED_RETRYABLE") return { state: "BUSY" };
    return { state: row.state === "FAILED" ? "FAILED_TERMINAL" : row.state,
      ...(row.summary_json ? { summary: JSON.parse(row.summary_json) as IngestionSummary } : {}) };
  }

  async renew(id: string, token: string, now: Date): Promise<boolean> {
    const at = now.getTime();
    const lease = at + INGESTION_LEASE_MS;
    const results = await this.database.batch([
      this.database.prepare(`UPDATE ingestion_operation_lock SET lease_until = ?
        WHERE id = 'production' AND request_id = ? AND attempt_token = ? AND lease_until > ?`).bind(lease, id, token, at),
      this.database.prepare(`UPDATE ingestion_logical_request SET lease_until = ?, updated_at = ?
        WHERE request_id = ? AND attempt_token = ? AND state = 'RUNNING' AND lease_until > ?
        AND EXISTS (SELECT 1 FROM ingestion_operation_lock WHERE id = 'production' AND attempt_token = ? AND lease_until = ?)`)
        .bind(lease, at, id, token, at, token, lease),
    ]);
    return results[0].meta.changes === 1 && results[1].meta.changes === 1;
  }

  private async updateRunning(id: string, token: string, now: Date, assignment: string, value: string | number): Promise<void> {
    const result = await this.database.prepare(`UPDATE ingestion_logical_request SET ${assignment}
      WHERE request_id = ? AND attempt_token = ? AND state = 'RUNNING' AND lease_until > ?
      AND EXISTS (SELECT 1 FROM ingestion_operation_lock WHERE id = 'production' AND attempt_token = ? AND lease_until > ?)`)
      .bind(value, id, token, now.getTime(), token, now.getTime()).run();
    if (result.meta.changes !== 1) throw new Error("Ingestion lease was lost");
  }

  savePlan(id: string, token: string, plan: IngestionPlan, now: Date): Promise<void> {
    return this.updateRunning(id, token, now, "plan_json = COALESCE(plan_json, ?)", JSON.stringify(plan));
  }

  markTerminalFailure(id: string, token: string, now: Date): Promise<void> {
    return this.updateRunning(id, token, now, "terminal_failure = ?", 1);
  }

  async finish(id: string, token: string, state: FinishedState, summary: IngestionSummary | null, now: Date): Promise<FinishedState> {
    const results = await this.database.batch([
      this.database.prepare(`UPDATE ingestion_logical_request SET state = CASE
        WHEN terminal_failure = 1 OR (? = 'FAILED_RETRYABLE' AND attempts >= ?) THEN 'FAILED_TERMINAL' ELSE ? END,
        summary_json = ?, updated_at = ? WHERE request_id = ? AND attempt_token = ? AND state = 'RUNNING' AND lease_until > ?
        AND EXISTS (SELECT 1 FROM ingestion_operation_lock WHERE id = 'production' AND attempt_token = ? AND lease_until > ?)
        RETURNING state`)
        .bind(state, MAX_INGESTION_ATTEMPTS, state, summary ? JSON.stringify(summary) : null, now.getTime(), id, token, now.getTime(), token, now.getTime()),
      this.database.prepare(`UPDATE ingestion_operation_lock SET lease_until = 0
        WHERE id = 'production' AND request_id = ? AND attempt_token = ?`).bind(id, token),
    ]);
    const row = results[0].results[0] as { state: FinishedState } | undefined;
    if (!row) throw new Error("Ingestion lease was lost");
    return row.state;
  }
}
