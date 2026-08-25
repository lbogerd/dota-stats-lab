import test from "node:test";
import assert from "node:assert/strict";
import { isValidMatchId, parseMatchId } from "../src/lib/match-id.js";

test("parseMatchId preserves unsigned 64-bit values as bigint", () => {
  assert.equal(parseMatchId("18446744073709551615"), 18_446_744_073_709_551_615n);
  assert.equal(isValidMatchId("18446744073709551615"), true);
});

for (const invalid of [undefined, "", "0", "-1", "+1", "1.0", " 1", "18446744073709551616"]) {
  test(`parseMatchId rejects ${String(invalid)}`, () => {
    assert.throws(() => parseMatchId(invalid));
    if (invalid !== undefined) assert.equal(isValidMatchId(invalid), false);
  });
}
