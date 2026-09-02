import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/news-ingestion.yml", "utf8");

describe("news ingestion workflow", () => {
  it("treats an absent optional database secret as not configured", () => {
    expect(workflow).toContain("id: database");
    expect(workflow).toContain('echo "configured=false" >> "$GITHUB_OUTPUT"');
    expect(workflow).toContain("### News ingestion is not configured");
  });

  it("gates every persistence step on a configured database", () => {
    for (const step of [
      "Check out repository",
      "Set up Node.js",
      "Install dependencies",
      "Apply database migrations",
      "Run bounded resumable ingestion",
    ]) {
      const start = workflow.indexOf(`- name: ${step}`);
      expect(start).toBeGreaterThan(-1);
      expect(workflow.slice(start, start + 220)).toContain(
        "if: steps.database.outputs.configured == 'true'",
      );
    }
  });
});
