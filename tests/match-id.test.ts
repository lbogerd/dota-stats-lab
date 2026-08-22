import test from "node:test";
import assert from "node:assert/strict";
import { parseMatchId } from "../src/lib/match-id.js";

test("parseMatchId preserves unsigned 64-bit values as bigint", () => {
  assert.equal(parseMatchId("18446744073709551615"), 18_446_744_073_709_551_615n);
});

for (const invalid of [undefined, "", "0", "-1", "+1", "1.0", " 1", "18446744073709551616"]) {
  test(`parseMatchId rejects ${String(invalid)}`, () => {
    assert.throws(() => parseMatchId(invalid));
  });
}
