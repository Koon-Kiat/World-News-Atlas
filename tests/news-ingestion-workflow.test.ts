import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/news-ingestion.yml", "utf8");

describe("news ingestion workflow", () => {
  it("invokes the bounded Sites endpoint every 30 minutes", () => {
    expect(workflow).toContain('cron: "*/30 * * * *"');
    expect(workflow).toContain("NEWS_INGEST_URL: ${{ secrets.NEWS_INGEST_URL }}");
    expect(workflow).toContain("for SCOPE in global countries countries");
    expect(workflow).toMatch(/stageLimit\\":4/u);
  });

  it("signs each exact body with a timestamp and one-time nonce", () => {
    expect(workflow).toContain("NEWS_INGEST_HMAC_SECRET: ${{ secrets.NEWS_INGEST_HMAC_SECRET }}");
    expect(workflow).toContain('NONCE="$(openssl rand -hex 24)"');
    expect(workflow).toContain("canonical = f\"{os.environ['TIMESTAMP']}.{os.environ['NONCE']}.{os.environ['BODY']}\"");
    expect(workflow).toContain('X-Ingest-Signature: $SIGNATURE');
    expect(workflow).not.toContain("DATABASE_URL");
    expect(workflow).not.toContain("prisma");
  });
});
