import assert from "node:assert/strict";
import test from "node:test";
import { isIngestionEnabled } from "../src/server/ingestion-runtime.js";

test("ingestion is enabled by default outside managed Compose deployments", () => {
  assert.equal(isIngestionEnabled({}), true);
});

test("ingestion can be held off by configuration", () => {
  assert.equal(isIngestionEnabled({ INGESTION_ENABLED: "false" }), false);
  assert.equal(isIngestionEnabled({ INGESTION_ENABLED: " FALSE " }), false);
  assert.equal(isIngestionEnabled({ INGESTION_ENABLED: "true" }), true);
});
