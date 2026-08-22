import { parseMatchId } from "../lib/match-id.js";
import { jsonStringify } from "../lib/json.js";

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "fetch") {
    const { fetchReplay } = await import("../fetch/fetch-replay.js");
    const acquisition = await fetchReplay(parseMatchId(process.env.MATCH_ID), process.env.REPLAY_SOURCE);
    process.stdout.write(`${jsonStringify(acquisition)}\n`);
    if (acquisition.status === "replay_unavailable") process.exitCode = 2;
    return;
  }
  if (command === "load") {
    const { loadExtraction } = await import("../load/load-extraction.js");
    const result = await loadExtraction(parseMatchId(process.env.MATCH_ID));
    process.stdout.write(`${jsonStringify(result)}\n`);
    return;
  }
  if (command === "check") {
    const { extractionAlreadyLoaded } = await import("../load/preflight.js");
    const loaded = await extractionAlreadyLoaded(
      parseMatchId(process.env.MATCH_ID), process.env.REPLAY_SHA256,
    );
    process.stdout.write(`${jsonStringify({ status: loaded ? "already_loaded" : "needed" })}\n`);
    if (!loaded) process.exitCode = 3;
    return;
  }
  if (command === "sql") {
    const { runSqlShell } = await import("./sql.js");
    await runSqlShell();
    return;
  }
  if (command === "migrate") {
    const { migrateOnly } = await import("../load/load-extraction.js");
    await migrateOnly();
    return;
  }
  throw new Error("Usage: cli/index.js fetch|check|load|sql|migrate");
}

main().catch((error: unknown) => {
  process.stderr.write(`dota: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
