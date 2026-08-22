import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowUpRight, FileCode2, Plus, Search, Sparkles } from "lucide-react";
import { useState } from "react";
import { formatRelative, queryKeys, queryNameSchema, saveQuery, savedQueriesQuery } from "../web/data";
import { PageHeading, PrimaryButton, SecondaryButton } from "../web/ui";

export const Route = createFileRoute("/queries/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(savedQueriesQuery()),
  component: QueriesPage,
});

const starterSql = "SELECT *\nFROM catalog.extractions\nORDER BY started_at DESC\nLIMIT 100;";

function QueriesPage() {
  const { data: queries } = useSuspenseQuery(savedQueriesQuery());
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const visible = queries.filter((query) => query.name.includes(filter.toLowerCase()));
  const mutation = useMutation({
    mutationFn: () => saveQuery(name, starterSql),
    onSuccess: async (query) => { await queryClient.invalidateQueries({ queryKey: queryKeys.queries }); await navigate({ to: "/queries/$queryName", params: { queryName: query.name } }); },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Could not create the query."),
  });
  function create(event: React.FormEvent) {
    event.preventDefault();
    const parsed = queryNameSchema.safeParse(name);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Invalid name."); return; }
    if (queries.some((query) => query.name === name)) { setError("A query with that name already exists."); return; }
    mutation.mutate();
  }
  return <>
    <PageHeading eyebrow="SQL workspace" title="Saved queries" description="Keep useful read-only SQL close at hand. Each query is stored as a durable plain-text file." action={<PrimaryButton type="button" onClick={() => setCreating(true)}><Plus size={17} /> New query</PrimaryButton>} />
    {creating && <form onSubmit={create} className="card mb-5 flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:p-5">
      <div className="min-w-0 flex-1"><label htmlFor="query-name" className="text-xs font-semibold">Query file name</label><div className="mt-1.5 flex items-center rounded-xl border border-[#daddd5] bg-white px-3"><input id="query-name" autoFocus value={name} onChange={(event) => setName(event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))} placeholder="team-net-worth" className="h-11 min-w-0 flex-1 bg-transparent font-mono text-sm outline-none" /><span className="font-mono text-xs text-[#98a09b]">.sql</span></div>{error && <p className="mt-1.5 text-xs font-medium text-[#a64234]">{error}</p>}</div>
      <div className="flex gap-2"><SecondaryButton type="button" onClick={() => { setCreating(false); setError(undefined); }}>Cancel</SecondaryButton><PrimaryButton type="submit" disabled={mutation.isPending || !name}>Create file</PrimaryButton></div>
    </form>}
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-[#e2e4dc] p-4 sm:px-5"><div className="relative w-full sm:w-64"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8d9590]" /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter saved queries" className="h-10 w-full rounded-xl border border-[#dcded7] bg-white pl-9 pr-3 text-sm outline-none focus:border-[#789781]" /></div><span className="hidden text-xs text-[#7c8580] sm:block">{queries.length} files</span></div>
      <div className="grid gap-3 p-3 sm:grid-cols-2 sm:p-4 xl:grid-cols-3">
        {visible.map((query) => <Link to="/queries/$queryName" params={{ queryName: query.name }} key={query.name} className="group flex min-h-44 flex-col rounded-2xl border border-[#e0e3da] bg-white p-4 transition hover:-translate-y-0.5 hover:border-[#b9c6bb] hover:shadow-[0_8px_24px_rgba(35,70,54,0.07)]">
          <div className="flex items-start justify-between"><div className="grid size-10 place-items-center rounded-xl bg-[#e6eddf] text-[#315f4a]"><FileCode2 size={18} /></div><ArrowUpRight size={17} className="text-[#a2aaa5] transition group-hover:text-[#315f4a]" /></div>
          <h2 className="mt-4 truncate font-mono text-sm font-semibold">{query.name}<span className="text-[#a0a7a2]">.sql</span></h2><p className="mt-2 line-clamp-2 font-mono text-[0.67rem] leading-5 text-[#848d87]">{query.sql.replace(/\s+/g, " ")}</p><p className="mt-auto pt-3 text-[0.65rem] font-medium text-[#9aa19c]">Edited {formatRelative(query.updatedAt)}</p>
        </Link>)}
        <button type="button" onClick={() => setCreating(true)} className="flex min-h-44 flex-col items-center justify-center rounded-2xl border border-dashed border-[#cdd2cb] p-4 text-center transition hover:border-[#7e9d87] hover:bg-white"><div className="grid size-10 place-items-center rounded-xl bg-[#eef0e9] text-[#6b776f]"><Plus size={18} /></div><p className="mt-3 text-sm font-semibold">Create a query</p><p className="mt-1 text-xs text-[#89918c]">Start from a safe template</p></button>
      </div>
    </section>
    <div className="mt-5 flex items-start gap-3 rounded-2xl bg-[#e4eadb] p-4 text-sm text-[#536158]"><Sparkles size={17} className="mt-0.5 shrink-0 text-[#315f4a]" /><p className="leading-6"><span className="font-semibold text-[#344139]">Plain files, no lock-in.</span> Saved queries persist across container replacement and can be downloaded at any time.</p></div>
  </>;
}
