import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ZodError } from "zod";
import {
  DEFAULT_QUERY_FILES_ROOT,
  QUERY_NAME_MAX_LENGTH,
  SavedQueryExistsError,
  SavedQueryNotFoundError,
  UnsafeSavedQueryFileError,
  configuredQueryFilesRoot,
  createSavedQueryStore,
  renameSavedQueryInputSchema,
  saveSavedQueryInputSchema,
  savedQueryNameInputSchema,
} from "../src/server/saved-queries.js";

async function fixture(): Promise<{ root: string; store: ReturnType<typeof createSavedQueryStore> }> {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "dota-saved-queries-"));
  const root = path.join(temporary, "queries");
  return { root, store: createSavedQueryStore(root) };
}

test("save creates the query root and atomically persists one SQL file", async () => {
  const { root, store } = await fixture();
  const saved = await store.save("hero-history", "SELECT 1;\n");

  assert.equal(saved.name, "hero-history");
  assert.equal(saved.sql, "SELECT 1;\n");
  assert.match(saved.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(await readFile(path.join(root, "hero-history.sql"), "utf8"), "SELECT 1;\n");
  assert.deepEqual(await readdir(root), ["hero-history.sql"]);

  // A fresh store represents a replacement web process using the same volume.
  const replacementStore = createSavedQueryStore(root);
  assert.equal((await replacementStore.read("hero-history"))?.sql, "SELECT 1;\n");
});

test("save replaces an existing regular file and list returns current file data", async () => {
  const { store } = await fixture();
  await store.save("z-last", "SELECT 'old';");
  await store.save("z-last", "SELECT 'new';");
  await store.save("a-first", "SELECT 1;");

  const reopened = await store.read("z-last");
  assert.equal(reopened?.sql, "SELECT 'new';");
  const listed = await store.list();
  assert.equal(listed.length, 2);
  assert.deepEqual(new Set(listed.map(({ name }) => name)), new Set(["a-first", "z-last"]));
  assert.equal(listed.find(({ name }) => name === "z-last")?.sql, "SELECT 'new';");
});

test("read returns null for a missing query", async () => {
  const { store } = await fixture();
  assert.equal(await store.read("missing"), null);
});

test("rename preserves SQL, refuses collisions, and handles no-op and missing sources", async () => {
  const { root, store } = await fixture();
  await store.save("source", "SELECT * FROM catalog.extractions;");
  const renamed = await store.rename("source", "destination");

  assert.equal(renamed.name, "destination");
  assert.equal(renamed.sql, "SELECT * FROM catalog.extractions;");
  await assert.rejects(readFile(path.join(root, "source.sql")), /ENOENT/);
  assert.equal((await store.rename("destination", "destination")).name, "destination");

  await store.save("occupied", "SELECT 2;");
  await assert.rejects(store.rename("destination", "occupied"), SavedQueryExistsError);
  assert.equal((await store.read("destination"))?.sql, "SELECT * FROM catalog.extractions;");
  assert.equal((await store.read("occupied"))?.sql, "SELECT 2;");
  await assert.rejects(store.rename("missing", "new-name"), SavedQueryNotFoundError);
});

test("delete removes regular query files and is idempotent for missing files", async () => {
  const { store } = await fixture();
  await store.save("temporary", "SELECT 1;");
  assert.equal(await store.delete("temporary"), true);
  assert.equal(await store.delete("temporary"), false);
  assert.equal(await store.read("temporary"), null);
});

test("all boundary schemas reject traversal, extensions, uppercase, long names, and blank SQL", () => {
  const unsafeNames = [
    "../warehouse",
    "nested/query",
    "query.sql",
    "Team-Net-Worth",
    "",
    "a".repeat(QUERY_NAME_MAX_LENGTH + 1),
  ];
  for (const name of unsafeNames) {
    assert.throws(() => savedQueryNameInputSchema.parse({ name }), ZodError);
  }
  assert.throws(
    () => saveSavedQueryInputSchema.parse({ name: "valid-name", sql: " \n\t" }),
    ZodError,
  );
  assert.throws(
    () => renameSavedQueryInputSchema.parse({ from: "valid", to: "../unsafe" }),
    ZodError,
  );
});

test("store operations validate unsafe names before touching the filesystem", async () => {
  const { root, store } = await fixture();
  await assert.rejects(store.read("../warehouse"), ZodError);
  await assert.rejects(store.save("query.sql", "SELECT 1"), ZodError);
  await assert.rejects(store.rename("valid", "../outside"), ZodError);
  await assert.rejects(store.delete(".."), ZodError);
  await assert.rejects(readdir(root), /ENOENT/);
});

test("query-shaped symbolic links are rejected by every file operation", async () => {
  const { root, store } = await fixture();
  await mkdir(root, { recursive: true });
  const target = path.join(path.dirname(root), "target.sql");
  await writeFile(target, "SELECT 'secret';");
  await symlink(target, path.join(root, "linked.sql"));

  await assert.rejects(store.list(), UnsafeSavedQueryFileError);
  await assert.rejects(store.read("linked"), UnsafeSavedQueryFileError);
  await assert.rejects(store.save("linked", "SELECT 1;"), UnsafeSavedQueryFileError);
  await assert.rejects(store.rename("linked", "renamed"), UnsafeSavedQueryFileError);
  await store.save("rename-source", "SELECT 2;");
  await assert.rejects(store.rename("rename-source", "linked"), UnsafeSavedQueryFileError);
  await assert.rejects(store.delete("linked"), UnsafeSavedQueryFileError);
  assert.equal(await readFile(target, "utf8"), "SELECT 'secret';");
});

test("a symbolic-link query root and query-shaped directories are rejected", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "dota-saved-query-root-"));
  const target = path.join(temporary, "real-root");
  const linkedRoot = path.join(temporary, "linked-root");
  await mkdir(target);
  await symlink(target, linkedRoot);
  await assert.rejects(createSavedQueryStore(linkedRoot).list(), UnsafeSavedQueryFileError);

  const { root, store } = await fixture();
  await mkdir(path.join(root, "not-a-file.sql"), { recursive: true });
  await assert.rejects(store.list(), UnsafeSavedQueryFileError);
  await assert.rejects(store.read("not-a-file"), UnsafeSavedQueryFileError);
});

test("QUERY_FILES_ROOT is configurable and defaults to the external-volume path", () => {
  const previous = process.env.QUERY_FILES_ROOT;
  try {
    delete process.env.QUERY_FILES_ROOT;
    assert.equal(configuredQueryFilesRoot(), DEFAULT_QUERY_FILES_ROOT);
    process.env.QUERY_FILES_ROOT = "/tmp/custom-query-root";
    assert.equal(configuredQueryFilesRoot(), "/tmp/custom-query-root");
    assert.equal(createSavedQueryStore().root, "/tmp/custom-query-root");
  } finally {
    if (previous === undefined) delete process.env.QUERY_FILES_ROOT;
    else process.env.QUERY_FILES_ROOT = previous;
  }
});
