import type { JsonValue } from "./warehouse.js";
import { withReadOnlyWarehouse } from "./warehouse.js";

export interface SqlCatalogColumn {
  name: string;
  dataType: string;
}

export interface SqlCatalogRelation {
  name: string;
  kind: "table" | "view";
  columns: SqlCatalogColumn[];
}

export interface SqlCatalogMacro {
  name: string;
  kind: "scalar" | "table";
  parameters: string[];
}

export interface SqlCatalogSchema {
  name: string;
  relations: SqlCatalogRelation[];
  macros: SqlCatalogMacro[];
}

export interface SqlCatalog {
  schemas: SqlCatalogSchema[];
}

/** Read the autocomplete metadata for the project's schemas from the active warehouse. */
export async function getSqlCatalog(): Promise<SqlCatalog> {
  return withReadOnlyWarehouse(async (connection) => {
    const schemaResult = await connection.runAndReadAll(SCHEMAS_SQL);
    const relationResult = await connection.runAndReadAll(RELATIONS_SQL);
    const macroResult = await connection.runAndReadAll(MACROS_SQL);

    const schemas = schemaResult.getRowObjectsJson().map<SqlCatalogSchema>((row) => ({
      name: stringValue(row.schema_name),
      relations: [],
      macros: [],
    }));
    const schemaByName = new Map(schemas.map((schema) => [schema.name, schema]));
    const relationsBySchema = new Map<string, Map<string, SqlCatalogRelation>>();

    for (const row of relationResult.getRowObjectsJson()) {
      const schema = requiredSchema(schemaByName, stringValue(row.schema_name));
      const relations = relationsBySchema.get(schema.name) ?? new Map<string, SqlCatalogRelation>();
      relationsBySchema.set(schema.name, relations);

      const relationName = stringValue(row.relation_name);
      let relation = relations.get(relationName);
      if (relation === undefined) {
        relation = {
          name: relationName,
          kind: relationKind(row.relation_kind),
          columns: [],
        };
        relations.set(relationName, relation);
        schema.relations.push(relation);
      }
      relation.columns.push({
        name: stringValue(row.column_name),
        dataType: stringValue(row.data_type),
      });
    }

    for (const row of macroResult.getRowObjectsJson()) {
      const schema = requiredSchema(schemaByName, stringValue(row.schema_name));
      schema.macros.push({
        name: stringValue(row.macro_name),
        kind: macroKind(row.macro_kind),
        parameters: stringArray(row.parameters),
      });
    }

    return { schemas };
  });
}

function requiredSchema(schemas: Map<string, SqlCatalogSchema>, name: string): SqlCatalogSchema {
  const schema = schemas.get(name);
  if (schema === undefined) throw new Error(`Unexpected SQL catalog schema: ${name}`);
  return schema;
}

function relationKind(value: JsonValue | undefined): SqlCatalogRelation["kind"] {
  if (value !== "table" && value !== "view") throw new Error("Unexpected SQL catalog relation kind");
  return value;
}

function macroKind(value: JsonValue | undefined): SqlCatalogMacro["kind"] {
  if (value !== "scalar" && value !== "table") throw new Error("Unexpected SQL catalog macro kind");
  return value;
}

function stringValue(value: JsonValue | undefined): string {
  if (typeof value !== "string") throw new Error("Unexpected SQL catalog value");
  return value;
}

function stringArray(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("Unexpected SQL catalog parameter list");
  }
  return value as string[];
}

const PROJECT_SCHEMAS_SQL = "'analysis', 'catalog', 'raw'";

const SCHEMAS_SQL = `
SELECT schema_name
FROM information_schema.schemata
WHERE catalog_name = current_database()
  AND schema_name IN (${PROJECT_SCHEMAS_SQL})
ORDER BY schema_name`;

const RELATIONS_SQL = `
SELECT
  tables.table_schema AS schema_name,
  tables.table_name AS relation_name,
  CASE tables.table_type WHEN 'VIEW' THEN 'view' ELSE 'table' END AS relation_kind,
  columns.column_name,
  columns.data_type
FROM information_schema.tables AS tables
JOIN information_schema.columns AS columns
  ON columns.table_catalog = tables.table_catalog
 AND columns.table_schema = tables.table_schema
 AND columns.table_name = tables.table_name
WHERE tables.table_catalog = current_database()
  AND tables.table_schema IN (${PROJECT_SCHEMAS_SQL})
  AND tables.table_type IN ('BASE TABLE', 'VIEW')
ORDER BY tables.table_schema, tables.table_name, columns.ordinal_position`;

const MACROS_SQL = `
SELECT
  schema_name,
  function_name AS macro_name,
  CASE function_type WHEN 'macro' THEN 'scalar' ELSE 'table' END AS macro_kind,
  parameters
FROM duckdb_functions()
WHERE database_name = current_database()
  AND schema_name IN (${PROJECT_SCHEMAS_SQL})
  AND function_type IN ('macro', 'table_macro')
ORDER BY schema_name, function_name`;
