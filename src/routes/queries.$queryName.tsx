import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import CodeMirror from "@uiw/react-codemirror";
import { ArrowLeft, Check, ChevronDown, Clipboard, Download, FileJson2, LoaderCircle, MoreHorizontal, Pencil, Play, Save, Table2, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { deleteQuery, queryKeys, queryNameSchema, renameQuery, runSql, saveQuery, savedQueryQuery, sqlCatalogQuery, type SqlResult } from "../web/data";
import { sqlLanguageForCatalog } from "../web/sql-autocomplete";
import { PrimaryButton, SecondaryButton } from "../web/ui";

export const Route = createFileRoute("/queries/$queryName")({
  loader: async ({ context, params }) => {
    const [query] = await Promise.all([
      context.queryClient.ensureQueryData(savedQueryQuery(params.queryName)),
      context.queryClient.prefetchQuery(sqlCatalogQuery()),
    ]);
    return query;
  },
  component: QueryEditorPage,
});

function downloadText(filename: string, value: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}

function resultCsv(result: SqlResult): string {
  const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [result.columns.map(quote).join(","), ...result.rows.map((row) => result.columns.map((column) => quote(row[column])).join(","))].join("\n");
}

function QueryEditorPage() {
  const { queryName } = Route.useParams();
  const { data: query } = useSuspenseQuery(savedQueryQuery(queryName));
  const catalogQuery = useQuery(sqlCatalogQuery());
  const client = useQueryClient();
  const navigate = useNavigate();
  const [sql, setSql] = useState(query?.sql ?? "");
  const [result, setResult] = useState<SqlResult>();
  const [tab, setTab] = useState<"table" | "json">("table");
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(queryName);
  const [renameError, setRenameError] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (query) setSql(query.sql); }, [query]);
  const dirty = query ? sql !== query.sql : Boolean(sql);
  const editorExtensions = useMemo(() => [sqlLanguageForCatalog(catalogQuery.data)], [catalogQuery.data]);

  const runMutation = useMutation({ mutationFn: () => runSql(sql), onSuccess: setResult });
  const saveMutation = useMutation({
    mutationFn: () => saveQuery(queryName, sql),
    onSuccess: async () => { setSaved(true); setTimeout(() => setSaved(false), 1600); await client.invalidateQueries({ queryKey: queryKeys.query(queryName) }); await client.invalidateQueries({ queryKey: queryKeys.queries }); },
  });
  const renameMutation = useMutation({
    mutationFn: () => renameQuery(queryName, newName),
    onSuccess: async (next) => { setRenaming(false); await client.invalidateQueries({ queryKey: queryKeys.queries }); await navigate({ to: "/queries/$queryName", params: { queryName: next.name } }); },
    onError: (cause) => setRenameError(cause instanceof Error ? cause.message : "Could not rename query."),
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteQuery(queryName),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: queryKeys.queries }); await navigate({ to: "/queries" }); },
  });

  if (!query) return <div className="card p-8"><h1 className="text-xl font-semibold">Query not found</h1><Link to="/queries" className="mt-4 inline-block text-sm font-semibold text-[#315f4a]">Return to saved queries</Link></div>;
  function submitRename(event: React.FormEvent) {
    event.preventDefault();
    const parsed = queryNameSchema.safeParse(newName);
    if (!parsed.success) { setRenameError(parsed.error.issues[0]?.message ?? "Invalid name."); return; }
    renameMutation.mutate();
  }

  return <>
    <div className="mb-4 flex items-center justify-between gap-3">
      <Link to="/queries" className="inline-flex min-h-10 items-center gap-1.5 text-xs font-semibold text-[#647068]"><ArrowLeft size={15} /> Saved queries</Link>
      <div className="relative"><button type="button" aria-label="Query actions" onClick={() => setMenuOpen((open) => !open)} className="grid size-10 place-items-center rounded-xl border border-[#d9ddd5] bg-[#fbfaf5] text-[#5f6b63]"><MoreHorizontal size={18} /></button>{menuOpen && <div className="absolute right-0 top-12 z-20 w-44 rounded-xl border border-[#dcded7] bg-white p-1.5 shadow-[0_12px_36px_rgba(30,45,37,0.13)]"><button onClick={() => { setRenaming(true); setMenuOpen(false); }} type="button" className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs font-semibold hover:bg-[#f1f2ec]"><Pencil size={14} /> Rename</button><button onClick={() => downloadText(`${queryName}.sql`, sql, "text/sql")} type="button" className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs font-semibold hover:bg-[#f1f2ec]"><Download size={14} /> Download SQL</button><button onClick={() => { setConfirmDelete(true); setMenuOpen(false); }} type="button" className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs font-semibold text-[#ac4638] hover:bg-[#fff0ec]"><Trash2 size={14} /> Delete</button></div>}</div>
    </div>

    <section className="card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-[#dfe2da] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0"><p className="eyebrow">SQL editor</p><div className="mt-1 flex min-w-0 items-center gap-2"><h1 className="truncate font-mono text-base font-semibold sm:text-lg">{queryName}<span className="text-[#98a09b]">.sql</span></h1>{dirty && <span className="size-2 shrink-0 rounded-full bg-[#e09a45]" title="Unsaved changes" />}</div></div>
        <div className="flex gap-2"><SecondaryButton type="button" onClick={() => saveMutation.mutate()} disabled={!dirty || saveMutation.isPending}>{saved ? <Check size={16} /> : saveMutation.isPending ? <LoaderCircle size={16} className="animate-spin" /> : <Save size={16} />}{saved ? "Saved" : "Save"}</SecondaryButton><PrimaryButton type="button" onClick={() => runMutation.mutate()} disabled={runMutation.isPending}>{runMutation.isPending ? <LoaderCircle size={16} className="animate-spin" /> : <Play size={15} fill="currentColor" />} Run <span className="ml-1 hidden border-l border-white/20 pl-2 text-[0.62rem] font-medium text-white/60 sm:inline">⌘↵</span></PrimaryButton></div>
      </div>
      <div className="overflow-hidden bg-[#202923]">
        <CodeMirror value={sql} onChange={setSql} extensions={editorExtensions} minHeight="290px" maxHeight="480px" basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true }} theme="dark" className="text-[13px] [&_.cm-editor]:bg-[#202923] [&_.cm-gutters]:bg-[#202923] [&_.cm-gutters]:border-r-[#344039] [&_.cm-content]:py-4" aria-label="SQL editor" />
      </div>
      {catalogQuery.isError && <div className="border-t border-[#e5cfaa] bg-[#fff8e8] px-5 py-3 text-xs font-medium text-[#80602b]">Database suggestions are not available. General SQL autocomplete still works.</div>}
      {runMutation.isError && <div className="border-t border-[#dca99e] bg-[#fff0ec] px-5 py-3 text-xs font-medium text-[#9b3f33]">{runMutation.error instanceof Error ? runMutation.error.message : "The query could not be run."}</div>}
    </section>

    <section className="card mt-5 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e1e3dc] px-4 py-3 sm:px-5">
        <div className="flex items-center gap-1 rounded-xl bg-[#eceee7] p-1"><button type="button" onClick={() => setTab("table")} className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold ${tab === "table" ? "bg-white text-[#304039] shadow-sm" : "text-[#7a837e]"}`}><Table2 size={14} /> Table</button><button type="button" onClick={() => setTab("json")} className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold ${tab === "json" ? "bg-white text-[#304039] shadow-sm" : "text-[#7a837e]"}`}><FileJson2 size={14} /> JSON</button></div>
        {result && <div className="flex items-center gap-1"><span className="mr-2 text-[0.65rem] text-[#838c86]">{result.totalRows} rows · {result.durationMs} ms</span><button type="button" onClick={() => navigator.clipboard.writeText(tab === "json" ? JSON.stringify(result.rows, null, 2) : resultCsv(result))} className="grid size-8 place-items-center rounded-lg text-[#68736d] hover:bg-[#ecefe8]" aria-label="Copy results"><Clipboard size={14} /></button><button type="button" onClick={() => downloadText(`result-${queryName}.${tab === "json" ? "json" : "csv"}`, tab === "json" ? JSON.stringify(result.rows, null, 2) : resultCsv(result), tab === "json" ? "application/json" : "text/csv")} className="grid size-8 place-items-center rounded-lg text-[#68736d] hover:bg-[#ecefe8]" aria-label="Download results"><Download size={14} /></button></div>}
      </div>
      {!result ? <div className="flex min-h-52 flex-col items-center justify-center p-8 text-center"><div className="grid size-11 place-items-center rounded-2xl bg-[#e7ece1] text-[#567260]"><Table2 size={19} /></div><p className="mt-3 text-sm font-semibold">Results will appear here</p><p className="mt-1 text-xs text-[#89918c]">Run the read-only query above to inspect up to 1,000 rows.</p></div> : tab === "json" ? <pre className="scrollbar-subtle max-h-[430px] overflow-auto bg-[#202923] p-5 font-mono text-xs leading-6 text-[#d9e0da]">{JSON.stringify(result.rows, null, 2)}</pre> : <div className="scrollbar-subtle max-h-[430px] overflow-auto"><table className="w-full min-w-[680px] border-collapse text-left font-mono text-xs"><thead className="sticky top-0 bg-[#eff0ea]"><tr>{result.columns.map((column) => <th key={column} className="border-b border-[#dfe1da] px-4 py-3 font-semibold text-[#4e5a53]">{column}</th>)}</tr></thead><tbody className="divide-y divide-[#e7e8e2]">{result.rows.map((row, index) => <tr key={index} className="hover:bg-white">{result.columns.map((column) => <td key={column} className="whitespace-nowrap px-4 py-3 text-[#5f6963]">{String(row[column] ?? "null")}</td>)}</tr>)}</tbody></table></div>}
      {result && <div className="flex items-center justify-between border-t border-[#e1e3dc] px-4 py-3 text-[0.65rem] text-[#838c86] sm:px-5"><span>Read-only result</span><span className="flex items-center gap-1">1,000 row limit <ChevronDown size={12} /></span></div>}
    </section>

    {renaming && <div className="fixed inset-0 z-50 grid place-items-center bg-[#152019]/45 p-4 backdrop-blur-sm"><form onSubmit={submitRename} className="w-full max-w-md rounded-[20px] bg-[#fbfaf5] p-5 shadow-2xl sm:p-6"><div className="flex items-center justify-between"><div><p className="eyebrow">Query file</p><h2 className="mt-1 text-lg font-semibold">Rename query</h2></div><button type="button" aria-label="Close" onClick={() => setRenaming(false)} className="grid size-9 place-items-center rounded-xl hover:bg-[#eceee7]"><X size={17} /></button></div><label htmlFor="rename-query" className="mt-5 block text-xs font-semibold">File name</label><div className="mt-1.5 flex items-center rounded-xl border border-[#d7dbd3] bg-white px-3"><input id="rename-query" autoFocus value={newName} onChange={(event) => setNewName(event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))} className="h-11 min-w-0 flex-1 bg-transparent font-mono text-sm outline-none" /><span className="font-mono text-xs text-[#9aa19c]">.sql</span></div>{renameError && <p className="mt-2 text-xs font-medium text-[#a64234]">{renameError}</p>}<div className="mt-5 flex justify-end gap-2"><SecondaryButton type="button" onClick={() => setRenaming(false)}>Cancel</SecondaryButton><PrimaryButton type="submit" disabled={renameMutation.isPending || newName === queryName}>Rename</PrimaryButton></div></form></div>}

    {confirmDelete && <div className="fixed inset-0 z-50 grid place-items-center bg-[#152019]/45 p-4 backdrop-blur-sm"><div className="w-full max-w-md rounded-[20px] bg-[#fbfaf5] p-5 shadow-2xl sm:p-6"><div className="grid size-11 place-items-center rounded-2xl bg-[#fae3de] text-[#a64638]"><Trash2 size={19} /></div><h2 className="mt-4 text-lg font-semibold">Delete {queryName}.sql?</h2><p className="mt-2 text-sm leading-6 text-[#6d7771]">This removes the saved file from the query volume. This action cannot be undone.</p><div className="mt-6 flex justify-end gap-2"><SecondaryButton type="button" onClick={() => setConfirmDelete(false)}>Keep file</SecondaryButton><button type="button" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#b54d3d] px-4 text-sm font-semibold text-white disabled:opacity-60">{deleteMutation.isPending && <LoaderCircle size={15} className="animate-spin" />} Delete</button></div></div></div>}
  </>;
}
