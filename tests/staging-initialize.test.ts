import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const stagingRoot = await mkdtemp(path.join(os.tmpdir(), "dota-staging-"));
process.env.STAGING_ROOT = stagingRoot;

const { initializeStagingLayout } = await import("../src/staging/initialize.js");

test("staging initialization creates the inbox, claimed, and jobs directories", async () => {
  await initializeStagingLayout();
  await initializeStagingLayout();

  for (const name of ["inbox", "claimed", "jobs"]) {
    assert.equal((await stat(path.join(stagingRoot, name))).isDirectory(), true);
  }
});
