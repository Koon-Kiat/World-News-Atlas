import nextEnv from "@next/env";
import { runNewsIngestion } from "../src/lib/news/ingest";
import { parseNewsCliOptions } from "./news-cli-options";

nextEnv.loadEnvConfig(process.cwd());

runNewsIngestion(parseNewsCliOptions("latest"))
  .then((summary) => {
    console.info(JSON.stringify({ event: "ingestion_summary", ...summary }, null, 2));
  })
  .catch(() => {
    console.error(
      JSON.stringify({
        event: "ingestion_failed",
        message: "News ingestion did not complete. Check server logs and database configuration.",
      }),
    );
    process.exitCode = 1;
  });
