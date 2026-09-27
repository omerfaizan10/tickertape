import Link from "next/link";
import { notFound } from "next/navigation";
import { ChecksList } from "@/components/checks-list";
import { FiguresTable } from "@/components/figures-table";
import { StatementView } from "@/components/statement-view";
import { getRun } from "@/lib/dashboard/queries";
import { FIELDS } from "@/lib/fields";
import { loadGoldenSet } from "@/lib/golden";
import { parseFiling, type FilingTable } from "@/lib/sec/filing-text";
import { loadFilingDocuments } from "@/lib/sec/filing-source";
import {
  locateStatement,
  type StatementKind,
} from "@/lib/sec/locate-statements";

export const dynamic = "force-dynamic";

const TITLE: Record<StatementKind, string> = {
  income: "Income statement",
  balance: "Balance sheet",
  cashflow: "Cash flow statement",
};

const AGENT_LABEL: Record<string, string> = {
  locator: "locator (code)",
  income_extractor: "income statement agent",
  balance_extractor: "balance sheet agent",
  cashflow_extractor: "cash flow agent",
  reconciler: "reconciler (code)",
};

// Re-derives the statements the run read. Parsing and locating are
// deterministic, so this is the same table the agents saw.
async function statementTables(
  run: NonNullable<Awaited<ReturnType<typeof getRun>>>,
): Promise<Partial<Record<StatementKind, FilingTable>> | null> {
  try {
    const { documents } = await loadFilingDocuments(run.ticker, {
      cik: run.cik,
      companyName: run.companyName,
      accessionNumber: run.accessionNumber,
      form: "10-K",
      filingDate: run.filingDate,
      reportDate: run.periodEnd,
      primaryDocument: run.url.split("/").pop()!,
      url: run.url,
    });
    const { tables } = parseFiling(documents);
    const out: Partial<Record<StatementKind, FilingTable>> = {};
    for (const s of run.statements) {
      const hit = locateStatement(tables, s.statement);
      if (hit) out[s.statement] = hit.table;
    }
    return out;
  } catch {
    return null;
  }
}

export default async function RunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const run = await getRun(id);
  if (!run) notFound();

  const golden = loadGoldenSet().filings.find(
    (f) => f.accessionNumber === run.accessionNumber,
  );
  const tables = await statementTables(run);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/runs" className="text-xs text-text-muted hover:text-text">
          ← runs
        </Link>
        <div className="mt-2 flex flex-wrap items-baseline gap-3">
          <h1 className="font-mono text-lg text-accent">{run.ticker}</h1>
          <span className="text-lg text-text">{run.companyName}</span>
          <span className="text-sm text-text-muted">
            {run.source === "golden_set" ? "eval run" : "live run"}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs text-text-muted">
          <span>10-K for period ending {run.periodEnd}</span>
          <span>
            {run.model} · prompt {run.promptVersion}
          </span>
          <span>${run.costUsd.toFixed(4)}</span>
          <span>{(run.latencyMs / 1000).toFixed(1)}s</span>
          {run.graded !== null ? (
            <span
              className={
                run.correct === run.graded ? "text-approve" : "text-review"
              }
            >
              {run.correct}/{run.graded} correct vs SEC
            </span>
          ) : null}
          <a
            href={run.url}
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            filing on sec.gov ↗
          </a>
        </div>
        {run.error ? (
          <div className="mt-3 rounded border border-escalate/30 bg-escalate-soft px-3 py-2 text-sm text-escalate">
            {run.error}
          </div>
        ) : null}
      </div>

      {run.figures.length > 0 ? (
        <section>
          <h2 className="mb-3 text-xs uppercase tracking-wide text-text-faint">
            figures
          </h2>
          <FiguresTable figures={run.figures} expected={golden?.answerKey} />
        </section>
      ) : null}

      {run.checks.length > 0 ? (
        <section>
          <h2 className="mb-3 text-xs uppercase tracking-wide text-text-faint">
            checks{run.retryCount > 0 ? " (after retry)" : ""}
          </h2>
          <ChecksList checks={run.checks} />
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 text-xs uppercase tracking-wide text-text-faint">
          trace
        </h2>
        <ol className="flex flex-col gap-1">
          {run.events.map((e) => (
            <li
              key={e.stepIndex}
              className="rounded border border-border-soft bg-surface"
            >
              <details>
                <summary className="flex cursor-pointer flex-wrap items-baseline gap-3 px-3 py-2 text-sm">
                  <span className="w-6 font-mono text-xs text-text-faint">
                    {e.stepIndex}
                  </span>
                  <span className={e.error ? "text-escalate" : "text-text"}>
                    {AGENT_LABEL[e.agentName] ?? e.agentName}
                  </span>
                  {(e.input as { retryHint?: string | null } | null)
                    ?.retryHint ? (
                    <span className="text-xs text-review">retry</span>
                  ) : null}
                  <span className="font-mono text-xs text-text-faint">
                    {(e.latencyMs / 1000).toFixed(2)}s
                    {e.tokensIn
                      ? ` · ${e.tokensIn + e.tokensOut} tokens · $${e.costUsd.toFixed(4)}`
                      : ""}
                  </span>
                  {e.error ? (
                    <span className="text-xs text-escalate">{e.error}</span>
                  ) : null}
                </summary>
                <div className="grid gap-3 border-t border-border-soft p-3 md:grid-cols-2">
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs text-text-muted">
                    {JSON.stringify(e.input, null, 2)}
                  </pre>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs text-text-muted">
                    {JSON.stringify(e.output, null, 2)}
                  </pre>
                </div>
              </details>
            </li>
          ))}
        </ol>
      </section>

      {run.statements.map((s) => {
        const table = tables?.[s.statement];
        const marks = new Map<number, string>();
        for (const f of s.figures) {
          if (f.rowIndex === null) continue;
          const label = FIELDS.find((x) => x.key === f.field)?.label ?? f.field;
          marks.set(
            f.rowIndex,
            marks.has(f.rowIndex)
              ? `${marks.get(f.rowIndex)}, ${label}`
              : label,
          );
        }
        return (
          <section key={s.statement}>
            <div className="mb-3 flex flex-wrap items-baseline gap-3">
              <h2 className="text-xs uppercase tracking-wide text-text-faint">
                {TITLE[s.statement]}
              </h2>
              <span className="font-mono text-xs text-text-faint">
                table #{s.tableIndex} · current period is figure column{" "}
                {s.currentColumn + 1}
              </span>
            </div>
            {table ? (
              <StatementView
                table={table}
                column={s.currentColumn}
                marks={marks}
              />
            ) : (
              <p className="text-xs text-text-faint">
                Couldn&apos;t load the filing to show the statement.
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
