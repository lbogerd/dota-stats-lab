import { EditorState } from "@uiw/react-codemirror";
import { describe, expect, it } from "vitest";
import type { SqlCatalog } from "../server/sql-catalog.js";
import { sqlLanguageForCatalog } from "./sql-autocomplete.js";

const catalog: SqlCatalog = {
  schemas: [
    {
      name: "analysis",
      relations: [],
      macros: [
        { name: "hero_at_time", kind: "scalar", parameters: ["match_id", "game_time"] },
        { name: "recent_events", kind: "table", parameters: ["match_id"] },
      ],
    },
    {
      name: "raw",
      relations: [
        {
          name: "records",
          kind: "table",
          columns: [
            { name: "match_id", dataType: "UBIGINT" },
            { name: "record_type", dataType: "VARCHAR" },
          ],
        },
        {
          name: "active_records",
          kind: "view",
          columns: [{ name: "match_id", dataType: "UBIGINT" }],
        },
      ],
      macros: [],
    },
  ],
};

interface CompletionOption {
  label: string;
  type?: string;
  detail?: string;
}

interface CompletionResult {
  options: readonly CompletionOption[];
}

type CompletionSource = (context: unknown) => CompletionResult | null | Promise<CompletionResult | null>;

async function completionsAt(markedSql: string, sqlCatalog: SqlCatalog | undefined = catalog) {
  const marker = markedSql.indexOf("|");
  const sql = marker === -1 ? markedSql : markedSql.slice(0, marker) + markedSql.slice(marker + 1);
  const position = marker === -1 ? sql.length : marker;
  const state = EditorState.create({ doc: sql, extensions: [sqlLanguageForCatalog(sqlCatalog)] });
  const context = {
    state,
    pos: position,
    explicit: true,
    matchBefore: (expression: RegExp) => {
      const match = expression.exec(state.sliceDoc(0, position));
      return match ? { from: match.index, to: position, text: match[0] } : null;
    },
  };
  const sources = state.languageDataAt<CompletionSource>("autocomplete", position);
  const results = await Promise.all(sources.map((source) => source(context)));

  return results.flatMap((result) => result?.options ?? []);
}

describe("sqlCatalogToNamespace", () => {
  it("suggests relations below their project schema", async () => {
    const options = await completionsAt("SELECT * FROM raw.");

    expect(options).toEqual([
      expect.objectContaining({ label: "records", type: "type", detail: "table" }),
      expect.objectContaining({ label: "active_records", type: "type", detail: "view" }),
    ]);
  });

  it("suggests typed columns for fully qualified relations", async () => {
    const options = await completionsAt("SELECT raw.records.");

    expect(options).toEqual([
      expect.objectContaining({ label: "match_id", type: "property", detail: "UBIGINT" }),
      expect.objectContaining({ label: "record_type", type: "property", detail: "VARCHAR" }),
    ]);
  });

  it("resolves relation aliases to the same typed columns", async () => {
    const options = await completionsAt("SELECT r.| FROM raw.records AS r");

    expect(options).toEqual([
      expect.objectContaining({ label: "match_id", detail: "UBIGINT" }),
      expect.objectContaining({ label: "record_type", detail: "VARCHAR" }),
    ]);
  });

  it("suggests schema macros with their kind and ordered parameters", async () => {
    const options = await completionsAt("SELECT * FROM analysis.");

    expect(options).toEqual([
      expect.objectContaining({
        label: "hero_at_time",
        type: "function",
        detail: "scalar macro (match_id, game_time)",
      }),
      expect.objectContaining({
        label: "recent_events",
        type: "function",
        detail: "table macro (match_id)",
      }),
    ]);
  });

  it("keeps standard SQL keyword suggestions uppercase", async () => {
    const options = await completionsAt("SEL");

    expect(options).toContainEqual(expect.objectContaining({ label: "SELECT", type: "keyword" }));
    expect(options).not.toContainEqual(expect.objectContaining({ label: "select" }));
  });

  it("keeps generic SQL autocomplete when catalog metadata is unavailable", async () => {
    const options = await completionsAt("SEL", undefined);

    expect(options).toContainEqual(expect.objectContaining({ label: "SELECT", type: "keyword" }));
  });
});
