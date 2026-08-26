import { loadSamplerConfig } from "./config.js";
import { RankedMatchSampler } from "./service.js";

const abortController = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => abortController.abort());
}

new RankedMatchSampler({ config: loadSamplerConfig() }).run(abortController.signal).catch((error: unknown) => {
  process.stderr.write(`ranked match sampler: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

