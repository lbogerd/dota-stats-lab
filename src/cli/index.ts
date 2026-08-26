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
    const matchId = parseMatchId(process.env.MATCH_ID);
    const [{ paths }, { claimExtraction }, { findPublishedExtractionId }, { loadClaimedExtraction }] = await Promise.all([
      import("../config.js"),
      import("../jobs/extraction-claim.js"),
      import("../jobs/parser-output.js"),
      import("../load/load-extraction.js"),
    ]);
    const extractionId = await findPublishedExtractionId(matchId);
    const claimed = await claimExtraction({
      matchId,
      claimId: `cli-${matchId}`,
      extractionId,
      inboxRoot: paths.stagingInboxRoot,
      claimedRoot: paths.stagingClaimedRoot,
    });
    const result = await loadClaimedExtraction(claimed);
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
  if (command === "init-staging") {
    const { initializeStagingLayout } = await import("../staging/initialize.js");
    await initializeStagingLayout();
    process.stdout.write(`${jsonStringify({ status: "initialized" })}\n`);
    return;
  }
  if (command === "parser-worker") {
    const { runParserWorker } = await import("../jobs/parser-worker-main.js");
    await runParserWorker();
    return;
  }
  if (command === "sampler") {
    const [{ loadSamplerConfig }, { RankedMatchSampler }] = await Promise.all([
      import("../sampler/config.js"),
      import("../sampler/service.js"),
    ]);
    const abortController = new AbortController();
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => abortController.abort());
    }
    await new RankedMatchSampler({ config: loadSamplerConfig() }).run(abortController.signal);
    return;
  }
  throw new Error("Usage: cli/index.js fetch|check|load|sql|migrate|init-staging|parser-worker|sampler");
}

main().catch((error: unknown) => {
  process.stderr.write(`dota: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
