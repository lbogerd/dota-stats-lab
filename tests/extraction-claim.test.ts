import test from "node:test";
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { claimExtraction } from "../src/jobs/extraction-claim.js";

const claimId = "00000000-0000-4000-8000-000000000000";
const extractionId = "a".repeat(64);
const matchId = 8953222159n;

test("claim atomically moves the exact extraction into job-owned storage", async () => {
  const roots = await testRoots();
  const source = path.join(roots.inboxRoot, matchId.toString(), extractionId);
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, "manifest.json"), "manifest\n");

  const claimed = await claimExtraction({ matchId, claimId, extractionId, ...roots });

  assert.equal(claimed.directory, path.join(roots.claimedRoot, claimId, extractionId));
  assert.equal(await readFile(path.join(claimed.directory, "manifest.json"), "utf8"), "manifest\n");
  await assert.rejects(lstat(source), { code: "ENOENT" });
});

test("claim is idempotent when only the claimed extraction exists", async () => {
  const roots = await testRoots();
  const destination = path.join(roots.claimedRoot, claimId, extractionId);
  await mkdir(destination, { recursive: true });

  const claimed = await claimExtraction({ matchId, claimId, extractionId, ...roots });

  assert.equal(claimed.directory, destination);
});

test("claim accepts a deterministic CLI claim ID", async () => {
  const roots = await testRoots();
  const cliClaimId = `cli-${matchId}`;
  const destination = path.join(roots.claimedRoot, cliClaimId, extractionId);
  await mkdir(destination, { recursive: true });

  const claimed = await claimExtraction({ matchId, claimId: cliClaimId, extractionId, ...roots });

  assert.equal(claimed.claimId, cliClaimId);
  assert.equal(claimed.directory, destination);
});

test("claim rejects ambiguous and missing extraction states", async (context) => {
  await context.test("both paths exist", async () => {
    const roots = await testRoots();
    await mkdir(path.join(roots.inboxRoot, matchId.toString(), extractionId), { recursive: true });
    await mkdir(path.join(roots.claimedRoot, claimId, extractionId), { recursive: true });
    await assert.rejects(
      claimExtraction({ matchId, claimId, extractionId, ...roots }),
      /exists in both inbox and claimed storage/,
    );
  });

  await context.test("neither path exists", async () => {
    const roots = await testRoots();
    await assert.rejects(
      claimExtraction({ matchId, claimId, extractionId, ...roots }),
      /does not exist in inbox or claimed storage/,
    );
  });
});

test("claim rejects symbolic links and non-directory paths", async (context) => {
  await context.test("symbolic-link parser output", async () => {
    const roots = await testRoots();
    const target = path.join(roots.root, "target");
    const source = path.join(roots.inboxRoot, matchId.toString(), extractionId);
    await mkdir(target);
    await mkdir(path.dirname(source), { recursive: true });
    await symlink(target, source);
    await assert.rejects(
      claimExtraction({ matchId, claimId, extractionId, ...roots }),
      /Parser output is a symbolic link/,
    );
  });

  await context.test("non-directory parser output", async () => {
    const roots = await testRoots();
    const source = path.join(roots.inboxRoot, matchId.toString(), extractionId);
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, "not a directory\n");
    await assert.rejects(
      claimExtraction({ matchId, claimId, extractionId, ...roots }),
      /Parser output is not a directory/,
    );
  });

  await context.test("symbolic-link claimed extraction", async () => {
    const roots = await testRoots();
    const target = path.join(roots.root, "target");
    const destination = path.join(roots.claimedRoot, claimId, extractionId);
    await mkdir(target);
    await mkdir(path.dirname(destination), { recursive: true });
    await symlink(target, destination);
    await assert.rejects(
      claimExtraction({ matchId, claimId, extractionId, ...roots }),
      /Claimed extraction is a symbolic link/,
    );
  });

  await context.test("non-directory claimed extraction", async () => {
    const roots = await testRoots();
    const destination = path.join(roots.claimedRoot, claimId, extractionId);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, "not a directory\n");
    await assert.rejects(
      claimExtraction({ matchId, claimId, extractionId, ...roots }),
      /Claimed extraction is not a directory/,
    );
  });
});

test("claim validates all path identifiers", async (context) => {
  const roots = await testRoots();
  await context.test("match ID", async () => {
    await assert.rejects(
      claimExtraction({ matchId: 0n, claimId, extractionId, ...roots }),
      /MATCH_ID must be a positive decimal integer/,
    );
  });
  await context.test("claim ID", async () => {
    await assert.rejects(
      claimExtraction({ matchId, claimId: "../job", extractionId, ...roots }),
      /Invalid claim ID/,
    );
  });
  await context.test("extraction ID", async () => {
    await assert.rejects(
      claimExtraction({ matchId, claimId, extractionId: "../extraction", ...roots }),
      /Invalid extraction ID/,
    );
  });
});

async function testRoots(): Promise<{ root: string; inboxRoot: string; claimedRoot: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "dota-extraction-claim-"));
  return {
    root,
    inboxRoot: path.join(root, "inbox"),
    claimedRoot: path.join(root, "claimed"),
  };
}
