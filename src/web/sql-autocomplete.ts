import { sql as sqlLanguage, type SQLNamespace } from "@codemirror/lang-sql";
import type { SqlCatalog } from "../server/sql-catalog.js";

/** Build the editor's SQL support, retaining standard SQL completion without catalog data. */
export function sqlLanguageForCatalog(catalog?: SqlCatalog): ReturnType<typeof sqlLanguage> {
  return sqlLanguage({
    schema: catalog ? sqlCatalogToNamespace(catalog) : undefined,
    upperCaseKeywords: true,
  });
}

/** Convert the application catalog into CodeMirror's nested SQL completion model. */
function sqlCatalogToNamespace(catalog: SqlCatalog): SQLNamespace {
  const namespace: Record<string, SQLNamespace> = {};

  for (const schema of catalog.schemas) {
    const schemaChildren: Record<string, SQLNamespace> = {};

    for (const relation of schema.relations) {
      schemaChildren[relation.name] = {
        self: {
          label: relation.name,
          type: "type",
          detail: relation.kind,
        },
        children: relation.columns.map((column) => ({
          label: column.name,
          type: "property",
          detail: column.dataType,
        })),
      };
    }

    for (const macro of schema.macros) {
      schemaChildren[macro.name] = {
        self: {
          label: macro.name,
          type: "function",
          detail: `${macro.kind} macro (${macro.parameters.join(", ")})`,
        },
        children: [],
      };
    }

    namespace[schema.name] = schemaChildren;
  }

  return namespace;
}
