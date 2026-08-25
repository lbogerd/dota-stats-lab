import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const DEFAULT_QUERY_FILES_ROOT = "/data/queries";
export const QUERY_NAME_MAX_LENGTH = 48;
export const QUERY_SQL_MAX_LENGTH = 1_000_000;

export const savedQueryNameSchema = z
  .string()
  .min(1, "Query name is required.")
  .max(QUERY_NAME_MAX_LENGTH, `Query name must be at most ${QUERY_NAME_MAX_LENGTH} characters.`)
  .regex(
    /^[a-z0-9_-]+$/,
    "Use lowercase letters, numbers, hyphens, or underscores.",
  );

export const savedQuerySqlSchema = z
  .string()
  .max(QUERY_SQL_MAX_LENGTH, `SQL must be at most ${QUERY_SQL_MAX_LENGTH} characters.`)
  .refine((sql) => sql.trim().length > 0, "SQL cannot be empty.");

export const saveSavedQueryInputSchema = z.object({
  name: savedQueryNameSchema,
  sql: savedQuerySqlSchema,
});

export const renameSavedQueryInputSchema = z.object({
  from: savedQueryNameSchema,
  to: savedQueryNameSchema,
});

export const savedQueryNameInputSchema = z.object({ name: savedQueryNameSchema });

export interface SavedQuery {
  name: string;
  sql: string;
  updatedAt: string;
}

export class SavedQueryNotFoundError extends Error {
  constructor(name: string) {
    super(`Saved query '${name}' was not found.`);
    this.name = "SavedQueryNotFoundError";
  }
}

export class SavedQueryExistsError extends Error {
  constructor(name: string) {
    super(`Saved query '${name}' already exists.`);
    this.name = "SavedQueryExistsError";
  }
}

export class UnsafeSavedQueryFileError extends Error {
  constructor(filePath: string) {
    super(`Saved query path is not a regular file: ${filePath}`);
    this.name = "UnsafeSavedQueryFileError";
  }
}

export function configuredQueryFilesRoot(): string {
  return process.env.QUERY_FILES_ROOT ?? DEFAULT_QUERY_FILES_ROOT;
}

export class SavedQueryStore {
  readonly root: string;

  constructor(root = configuredQueryFilesRoot()) {
    this.root = path.resolve(root);
  }

  async list(): Promise<SavedQuery[]> {
    await this.ensureSafeRoot();
    const entries = await readdir(this.root, { withFileTypes: true });
    const queries: SavedQuery[] = [];

    for (const entry of entries) {
      const match = /^([a-z0-9_-]{1,48})\.sql$/.exec(entry.name);
      if (!match) continue;
      const name = savedQueryNameSchema.parse(match[1]);
      if (!entry.isFile()) {
        throw new UnsafeSavedQueryFileError(this.queryPath(name));
      }
      const query = await this.read(name);
      // A concurrent rename or deletion may remove an entry after readdir.
      if (query) queries.push(query);
    }

    return queries.sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || left.name.localeCompare(right.name),
    );
  }

  async read(name: string): Promise<SavedQuery | null> {
    const safeName = savedQueryNameSchema.parse(name);
    await this.ensureSafeRoot();
    return this.readSafeFile(safeName);
  }

  async save(name: string, sql: string): Promise<SavedQuery> {
    const input = saveSavedQueryInputSchema.parse({ name, sql });
    await this.ensureSafeRoot();
    const destination = this.queryPath(input.name);
    await this.assertRegularFileOrMissing(destination);

    const temporary = path.join(
      this.root,
      `.saved-query-${process.pid}-${randomUUID()}.tmp`,
    );
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(
        temporary,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      await handle.writeFile(input.sql, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;

      // Recheck an existing destination immediately before replacing it. A rename
      // replaces the directory entry itself and never follows the destination.
      await this.assertRegularFileOrMissing(destination);
      await rename(temporary, destination);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
      throw error;
    }

    const saved = await this.readSafeFile(input.name);
    if (!saved) throw new SavedQueryNotFoundError(input.name);
    return saved;
  }

  async rename(from: string, to: string): Promise<SavedQuery> {
    const input = renameSavedQueryInputSchema.parse({ from, to });
    await this.ensureSafeRoot();

    if (input.from === input.to) {
      const existing = await this.readSafeFile(input.from);
      if (!existing) throw new SavedQueryNotFoundError(input.from);
      return existing;
    }

    const source = this.queryPath(input.from);
    const destination = this.queryPath(input.to);
    await this.assertRegularFile(source, input.from);
    if (await this.pathExists(destination)) {
      await this.assertRegularFile(destination, input.to);
      throw new SavedQueryExistsError(input.to);
    }

    await rename(source, destination);
    const renamed = await this.readSafeFile(input.to);
    if (!renamed) throw new SavedQueryNotFoundError(input.to);
    return renamed;
  }

  async delete(name: string): Promise<boolean> {
    const safeName = savedQueryNameSchema.parse(name);
    await this.ensureSafeRoot();
    const filePath = this.queryPath(safeName);
    const exists = await this.assertRegularFileOrMissing(filePath);
    if (!exists) return false;
    await unlink(filePath);
    return true;
  }

  private async ensureSafeRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const stats = await lstat(this.root);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new UnsafeSavedQueryFileError(this.root);
    }
  }

  private queryPath(name: string): string {
    const filePath = path.resolve(this.root, `${name}.sql`);
    if (path.dirname(filePath) !== this.root) {
      throw new UnsafeSavedQueryFileError(filePath);
    }
    return filePath;
  }

  private async readSafeFile(name: string): Promise<SavedQuery | null> {
    const filePath = this.queryPath(name);
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return null;
      if (isNodeError(error, "ELOOP")) throw new UnsafeSavedQueryFileError(filePath);
      throw error;
    }

    try {
      const stats = await handle.stat();
      if (!stats.isFile()) throw new UnsafeSavedQueryFileError(filePath);
      return {
        name,
        sql: await handle.readFile("utf8"),
        updatedAt: stats.mtime.toISOString(),
      };
    } finally {
      await handle.close();
    }
  }

  private async assertRegularFile(filePath: string, name: string): Promise<void> {
    let stats;
    try {
      stats = await lstat(filePath);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) throw new SavedQueryNotFoundError(name);
      throw error;
    }
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new UnsafeSavedQueryFileError(filePath);
    }
  }

  private async assertRegularFileOrMissing(filePath: string): Promise<boolean> {
    let stats;
    try {
      stats = await lstat(filePath);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return false;
      throw error;
    }
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new UnsafeSavedQueryFileError(filePath);
    }
    return true;
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await lstat(filePath);
      return true;
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return false;
      throw error;
    }
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

export function createSavedQueryStore(root?: string): SavedQueryStore {
  return root === undefined ? new SavedQueryStore() : new SavedQueryStore(root);
}
