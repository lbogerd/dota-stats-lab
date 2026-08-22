import { DuckDBInstance, StatementType, type DuckDBConnection } from "@duckdb/node-api";
import { paths } from "../config.js";
import { withWarehouseLock } from "../db/lock.js";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type SqlTruncationReason = "row_limit" | "response_size" | null;

export interface ReadOnlySqlResult {
  columns: string[];
  columnTypes: string[];
  rows: Array<Record<string, JsonValue>>;
  totalRows: number;
  durationMs: number;
  truncated: boolean;
  truncationReason: SqlTruncationReason;
}

export interface ReadOnlySqlOptions {
  rowLimit?: number;
  maxResponseBytes?: number;
}

export type BrowserSqlErrorCode =
  | "INVALID_SQL"
  | "ONLY_ONE_STATEMENT"
  | "READ_ONLY_REQUIRED"
  | "RESULT_TOO_LARGE";

export class BrowserSqlError extends Error {
  readonly code: BrowserSqlErrorCode;

  constructor(code: BrowserSqlErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BrowserSqlError";
    this.code = code;
  }
}

const DEFAULT_ROW_LIMIT = 500;
const MAX_ROW_LIMIT = 5_000;
const DEFAULT_RESPONSE_BYTES = 1_000_000;
const MAX_RESPONSE_BYTES = 5_000_000;
const MAX_SQL_BYTES = 100_000;
const QUERY_KEYWORDS = new Set(["SELECT", "WITH", "VALUES", "SHOW", "DESCRIBE", "DESC", "SUMMARIZE", "FROM", "PIVOT"]);

const READ_ONLY_OPTIONS = Object.freeze({
  access_mode: "READ_ONLY",
  threads: "1",
  memory_limit: "512MB",
  enable_external_access: "false",
  allow_unsigned_extensions: "false",
  autoinstall_known_extensions: "false",
  autoload_known_extensions: "false",
  lock_configuration: "true",
});

/**
 * Runs database work behind the same filesystem lock used by loaders. The
 * callback receives a connection whose engine configuration cannot be changed,
 * whose database is read-only, and whose filesystem/extension access is off.
 */
export async function withReadOnlyWarehouse<T>(
  operation: (connection: DuckDBConnection) => Promise<T>,
): Promise<T> {
  return withWarehouseLock(paths.warehousePath, async () => {
    let instance: DuckDBInstance | undefined;
    let connection: DuckDBConnection | undefined;
    try {
      instance = await DuckDBInstance.create(paths.warehousePath, READ_ONLY_OPTIONS);
      connection = await instance.connect();
      return await operation(connection);
    } finally {
      try {
        connection?.closeSync();
      } finally {
        instance?.closeSync();
      }
    }
  });
}

/** Execute one browser-supplied, read-only statement with bounded output. */
export async function executeReadOnlySql(
  sql: string,
  options: ReadOnlySqlOptions = {},
): Promise<ReadOnlySqlResult> {
  if (typeof sql !== "string" || sql.trim() === "") {
    throw new BrowserSqlError("INVALID_SQL", "Write a query before running it.");
  }
  if (Buffer.byteLength(sql, "utf8") > MAX_SQL_BYTES) {
    throw new BrowserSqlError("INVALID_SQL", `SQL must be at most ${MAX_SQL_BYTES.toLocaleString()} bytes.`);
  }

  const rowLimit = boundedInteger("rowLimit", options.rowLimit ?? DEFAULT_ROW_LIMIT, 1, MAX_ROW_LIMIT);
  const maxResponseBytes = boundedInteger(
    "maxResponseBytes",
    options.maxResponseBytes ?? DEFAULT_RESPONSE_BYTES,
    256,
    MAX_RESPONSE_BYTES,
  );

  return withReadOnlyWarehouse(async (connection) => {
    const started = performance.now();
    let extracted;
    try {
      extracted = await connection.extractStatements(sql);
    } catch (error) {
      throw new BrowserSqlError("INVALID_SQL", errorMessage(error), { cause: error });
    }
    if (extracted.count !== 1) {
      throw new BrowserSqlError("ONLY_ONE_STATEMENT", "Run exactly one SQL statement at a time.");
    }
    if (!QUERY_KEYWORDS.has(firstKeyword(sql))) {
      throw new BrowserSqlError("READ_ONLY_REQUIRED", "Only read-only SELECT queries are allowed.");
    }

    let statement;
    try {
      statement = await extracted.prepare(0);
    } catch (error) {
      throw new BrowserSqlError("INVALID_SQL", errorMessage(error), { cause: error });
    }
    try {
      if (statement.statementType !== StatementType.SELECT) {
        throw new BrowserSqlError("READ_ONLY_REQUIRED", "Only read-only SELECT queries are allowed.");
      }

      const reader = await statement.streamAndReadUntil(rowLimit + 1);
      const columns = reader.deduplicatedColumnNames();
      const columnTypes = reader.columnTypes().map((type) => type.toString());
      const fetchedRows = reader.getRowsJson();
      const rowLimited = fetchedRows.length > rowLimit || !reader.done;
      const selectedRows = fetchedRows.slice(0, rowLimit).map((values) => rowObject(columns, values));
      const durationMs = Math.max(0, Math.round(performance.now() - started));

      let truncationReason: SqlTruncationReason = rowLimited ? "row_limit" : null;
      let rows = selectedRows;
      let result = makeResult(columns, columnTypes, rows, durationMs, truncationReason);
      while (rows.length > 0 && jsonBytes(result) > maxResponseBytes) {
        rows = rows.slice(0, -1);
        truncationReason = "response_size";
        result = makeResult(columns, columnTypes, rows, durationMs, truncationReason);
      }
      if (jsonBytes(result) > maxResponseBytes) {
        throw new BrowserSqlError(
          "RESULT_TOO_LARGE",
          `SQL result metadata exceeds the ${maxResponseBytes.toLocaleString()} byte response limit.`,
        );
      }
      return result;
    } finally {
      statement.destroySync();
    }
  });
}

function makeResult(
  columns: string[],
  columnTypes: string[],
  rows: Array<Record<string, JsonValue>>,
  durationMs: number,
  truncationReason: SqlTruncationReason,
): ReadOnlySqlResult {
  return {
    columns,
    columnTypes,
    rows,
    totalRows: rows.length,
    durationMs,
    truncated: truncationReason !== null,
    truncationReason,
  };
}

function rowObject(columns: string[], values: JsonValue[]): Record<string, JsonValue> {
  return Object.fromEntries(columns.map((column, index) => [column, values[index] ?? null]));
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function boundedInteger(name: string, value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Return the first token while ignoring leading whitespace and SQL comments. */
function firstKeyword(sql: string): string {
  let index = 0;
  while (index < sql.length) {
    while (/\s/.test(sql[index] ?? "")) index++;
    if (sql.startsWith("--", index)) {
      const newline = sql.indexOf("\n", index + 2);
      index = newline === -1 ? sql.length : newline + 1;
      continue;
    }
    if (sql.startsWith("/*", index)) {
      const end = sql.indexOf("*/", index + 2);
      if (end === -1) return "";
      index = end + 2;
      continue;
    }
    break;
  }
  return /^[a-z]+/i.exec(sql.slice(index))?.[0]?.toUpperCase() ?? "";
}
