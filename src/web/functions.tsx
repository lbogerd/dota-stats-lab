import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { isValidMatchId } from "../lib/match-id.js";
import { getMatchDetail, listMatches } from "../server/catalog.js";
import { ensureIngestionCoordinator } from "../server/ingestion-runtime.js";
import {
  createSavedQueryStore,
  renameSavedQueryInputSchema,
  saveSavedQueryInputSchema,
  savedQueryNameInputSchema,
} from "../server/saved-queries.js";
import { getSqlCatalog } from "../server/sql-catalog.js";
import { getMatchOverview, listMatchOverviews } from "../server/overview.js";
import { executeReadOnlySql } from "../server/warehouse.js";

export const listSavedQueriesFn = createServerFn({ method: "GET" })
  .handler(() => createSavedQueryStore().list());

export const readSavedQueryFn = createServerFn({ method: "GET" })
  .validator(savedQueryNameInputSchema)
  .handler(({ data }) => createSavedQueryStore().read(data.name));

export const saveSavedQueryFn = createServerFn({ method: "POST" })
  .validator(saveSavedQueryInputSchema)
  .handler(({ data }) => createSavedQueryStore().save(data.name, data.sql));

export const renameSavedQueryFn = createServerFn({ method: "POST" })
  .validator(renameSavedQueryInputSchema)
  .handler(({ data }) => createSavedQueryStore().rename(data.from, data.to));

export const deleteSavedQueryFn = createServerFn({ method: "POST" })
  .validator(savedQueryNameInputSchema)
  .handler(({ data }) => createSavedQueryStore().delete(data.name));

export const downloadSavedQueryFn = createServerFn({ method: "GET" })
  .validator(savedQueryNameInputSchema)
  .handler(({ data }) => createSavedQueryStore().download(data.name));

const matchIdInputSchema = z.object({
  matchId: z.string().refine(isValidMatchId, "Enter a positive match ID in the DuckDB UBIGINT range."),
});

const browserSqlInputSchema = z.object({
  sql: z.string().min(1).max(100_000),
});

export const listMatchesFn = createServerFn({ method: "GET" })
  .handler(() => listMatches());

export const getMatchDetailFn = createServerFn({ method: "GET" })
  .validator(matchIdInputSchema)
  .handler(({ data }) => getMatchDetail(data.matchId));

export const listMatchOverviewsFn = createServerFn({ method: "GET" })
  .handler(() => listMatchOverviews());

export const getMatchOverviewFn = createServerFn({ method: "GET" })
  .validator(matchIdInputSchema)
  .handler(({ data }) => getMatchOverview(data.matchId));

export const runSqlFn = createServerFn({ method: "POST" })
  .validator(browserSqlInputSchema)
  .handler(({ data }) => executeReadOnlySql(data.sql));

export const getSqlCatalogFn = createServerFn({ method: "GET" })
  .handler(() => getSqlCatalog());

export const listJobsFn = createServerFn({ method: "GET" })
  .handler(() => ensureIngestionCoordinator().list());

export const submitIngestionFn = createServerFn({ method: "POST" })
  .validator(matchIdInputSchema)
  .handler(({ data }) => ensureIngestionCoordinator().enqueue(BigInt(data.matchId)));
