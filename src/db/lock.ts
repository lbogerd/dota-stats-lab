import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

const STALE_AFTER_MS = 10 * 60_000;
const WAIT_TIMEOUT_MS = 30_000;
let localQueue: Promise<void> = Promise.resolve();

/**
 * Serializes DuckDB ownership in-process and uses a recoverable lease between
 * the web and optional CLI loader processes. A killed process cannot wedge the
 * warehouse forever: an old lease is removed after the bounded stale period.
 */
export async function withWarehouseLock<T>(warehousePath: string, operation: () => Promise<T>): Promise<T> {
  const previous = localQueue;
  let releaseLocal!: () => void;
  localQueue = new Promise<void>((resolve) => { releaseLocal = resolve; });
  await previous;
  try {
    return await withFileLease(warehousePath, operation);
  } finally {
    releaseLocal();
  }
}

async function withFileLease<T>(warehousePath: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = path.join(path.dirname(warehousePath), "dota.lock");
  await mkdir(path.dirname(lockPath), { recursive: true });
  const token = `${randomUUID()} ${process.pid} ${new Date().toISOString()}\n`;
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  let handle;
  while (handle === undefined) {
    try {
      handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(token);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await isStale(lockPath)) {
        await rm(lockPath, { force: true });
        continue;
      }
      if (Date.now() >= deadline) throw new Error("Warehouse is busy; try again shortly.");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    return await operation();
  } finally {
    await handle.close();
    const owner = await readFile(lockPath, "utf8").catch(() => "");
    if (owner === token) await rm(lockPath, { force: true });
  }
}

async function isStale(lockPath: string): Promise<boolean> {
  const info = await stat(lockPath).catch(() => null);
  return info !== null && Date.now() - info.mtimeMs > STALE_AFTER_MS;
}
