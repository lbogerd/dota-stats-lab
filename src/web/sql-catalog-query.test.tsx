import { describe, expect, it } from "vitest";
import { queryKeys, sqlCatalogQuery } from "./data.js";

describe("sqlCatalogQuery", () => {
  it("loads the catalog once per browser session", () => {
    const options = sqlCatalogQuery();

    expect(options.queryKey).toEqual(["sql-catalog"]);
    expect(options.queryKey).toBe(queryKeys.sqlCatalog);
    expect(options.staleTime).toBe(Infinity);
    expect(options.gcTime).toBe(Infinity);
    expect(options.retry).toBe(1);
    expect(options.refetchOnMount).toBe(false);
  });
});
