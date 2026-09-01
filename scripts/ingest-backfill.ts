import nextEnv from "@next/env";
import { runNewsIngestion } from "../src/lib/news/ingest";
import { parseNewsCliOptions } from "./news-cli-options";

nextEnv.loadEnvConfig(process.cwd());

runNewsIngestion({ ...parseNewsCliOptions("30d"), mode: "backfill" })
  .then((summary) => console.info(JSON.stringify({ event: "backfill_summary", ...summary }, null, 2)))
  .catch((error) => {
    console.error(JSON.stringify({
      event: "backfill_failed",
      code: error instanceof Error ? error.name : "UNEXPECTED_FAILURE",
      message: "Historical ingestion did not complete; its saved checkpoint can be resumed safely.",
    }));
    process.exitCode = 1;
  });
