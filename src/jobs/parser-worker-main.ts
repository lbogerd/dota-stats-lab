import { ParserWorker } from "./parser-worker.js";

export async function runParserWorker(): Promise<void> {
  const worker = new ParserWorker();
  const stopping = new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  worker.start();
  await stopping;
  await worker.stop();
}
