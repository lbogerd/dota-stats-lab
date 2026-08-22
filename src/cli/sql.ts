import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { paths } from "../config.js";
import { migrate, openWarehouse } from "../db/database.js";
import { withWarehouseLock } from "../db/lock.js";
import { jsonStringify } from "../lib/json.js";

export async function runSqlShell(): Promise<void> {
  await withWarehouseLock(paths.warehousePath, async () => {
    const database = await openWarehouse();
    try {
      await migrate(database.connection);
      if (!stdin.isTTY) {
        const chunks: Buffer[] = [];
        for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
        await execute(database.connection, Buffer.concat(chunks).toString("utf8"));
        return;
      }
      stdout.write("Dota Replay Data Lab SQL shell. End a query with ';', or type .quit\n");
      const terminal = createInterface({ input: stdin, output: stdout });
      let sql = "";
      try {
        while (true) {
          const line = await terminal.question(sql === "" ? "dota> " : "   -> ");
          if (line.trim() === ".quit" || line.trim() === ".exit") break;
          sql += `${line}\n`;
          if (!line.trimEnd().endsWith(";")) continue;
          try { await execute(database.connection, sql); }
          catch (error) { stdout.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`); }
          sql = "";
        }
      } finally { terminal.close(); }
    } finally { database.close(); }
  });
}

async function execute(connection: Awaited<ReturnType<typeof openWarehouse>>["connection"], sql: string): Promise<void> {
  if (sql.trim() === "") return;
  const reader = await connection.runAndReadAll(sql);
  const rows = reader.getRowObjectsJson();
  if (rows.length === 0) { stdout.write("OK\n"); return; }
  for (const row of rows) stdout.write(`${jsonStringify(row)}\n`);
  stdout.write(`${rows.length} row(s)\n`);
}
