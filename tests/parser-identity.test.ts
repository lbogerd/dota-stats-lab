import test from "node:test";
import assert from "node:assert/strict";
import { manifestParserIdentity, parserIdentity } from "../src/load/parser-identity.js";

test("shared parser identity keeps source and export versions distinct", () => {
  assert.match(parserIdentity.forkRevision, /^[a-f0-9]{40}$/);
  assert.notEqual(parserIdentity.upstreamRelease, parserIdentity.forkRevision);
  assert.equal(parserIdentity.version, parserIdentity.forkRevision);
  assert.equal(manifestParserIdentity.upstreamRelease, parserIdentity.upstreamRelease);
  assert.equal(manifestParserIdentity.forkRevision, parserIdentity.forkRevision);
  assert.equal(manifestParserIdentity.version, parserIdentity.forkRevision);
});
