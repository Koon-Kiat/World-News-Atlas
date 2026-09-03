const AUTH_WINDOW_MS = 5 * 60_000;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{24,128}$/u;
const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/u;

export interface IngestionAuthHeaders {
  timestamp: string | null;
  nonce: string | null;
  signature: string | null;
}

export interface VerifiedIngestionAuth {
  nonce: string;
  receivedAt: Date;
  expiresAt: Date;
}

function hexToBuffer(value: string): ArrayBuffer {
  const buffer = new ArrayBuffer(value.length / 2);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return buffer;
}

function bytesToHex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacKey(secret: string, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usage);
}

export function ingestionAuthHeaders(headers: Headers): IngestionAuthHeaders {
  return {
    timestamp: headers.get("x-ingest-timestamp"),
    nonce: headers.get("x-ingest-nonce"),
    signature: headers.get("x-ingest-signature"),
  };
}

export async function signIngestionPayload(secret: string, timestamp: string, nonce: string, rawBody: string): Promise<string> {
  const key = await hmacKey(secret, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${nonce}.${rawBody}`));
  return bytesToHex(signature);
}

export async function verifyIngestionAuth(
  secret: string,
  headers: IngestionAuthHeaders,
  rawBody: string,
  now = new Date(),
): Promise<VerifiedIngestionAuth | null> {
  if (secret.length < 32 || !headers.timestamp || !headers.nonce || !headers.signature) return null;
  if (!/^\d{10,13}$/u.test(headers.timestamp) || !NONCE_PATTERN.test(headers.nonce)) return null;
  const signature = headers.signature.toLowerCase().replace(/^sha256=/u, "");
  if (!SIGNATURE_PATTERN.test(signature)) return null;
  const rawTimestamp = Number(headers.timestamp);
  if (!Number.isSafeInteger(rawTimestamp)) return null;
  const timestampMs = headers.timestamp.length <= 10 ? rawTimestamp * 1_000 : rawTimestamp;
  if (Math.abs(now.getTime() - timestampMs) > AUTH_WINDOW_MS) return null;
  const key = await hmacKey(secret, ["verify"]);
  const valid = await crypto.subtle.verify("HMAC", key, hexToBuffer(signature), new TextEncoder().encode(`${headers.timestamp}.${headers.nonce}.${rawBody}`));
  return valid ? { nonce: headers.nonce, receivedAt: now, expiresAt: new Date(timestampMs + AUTH_WINDOW_MS) } : null;
}
