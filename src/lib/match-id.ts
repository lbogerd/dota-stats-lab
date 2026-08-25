export function parseMatchId(value: string | undefined): bigint {
  if (value === undefined || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error("MATCH_ID must be a positive decimal integer");
  }
  const id = BigInt(value);
  if (id > 18_446_744_073_709_551_615n) {
    throw new Error("MATCH_ID exceeds DuckDB UBIGINT range");
  }
  return id;
}

export function isValidMatchId(value: string): boolean {
  try {
    parseMatchId(value);
    return true;
  } catch {
    return false;
  }
}
