import "server-only";

export async function getSitesD1Binding(): Promise<D1Database | null> {
  try {
    const workers = await import("cloudflare:workers");
    return (workers.env as unknown as { DB?: D1Database }).DB ?? null;
  } catch {
    return null;
  }
}
