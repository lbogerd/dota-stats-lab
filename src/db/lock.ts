import { mkdir, open, rm } from "node:fs/promises";
import path from "node:path";

export async function withWarehouseLock<T>(warehousePath: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = path.join(path.dirname(warehousePath), "dota.lock");
  await mkdir(path.dirname(lockPath), { recursive: true });
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(`${process.pid}\n`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Warehouse is in use (lock file ${lockPath})`);
    }
    throw error;
  }
  try { return await operation(); }
  finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}
