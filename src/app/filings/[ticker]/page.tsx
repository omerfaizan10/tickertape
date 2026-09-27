import Link from "next/link";
import { notFound } from "next/navigation";
import { FIELDS, type FieldSpec } from "@/lib/fields";
import {
  loadGoldenSet,
  loadStatementTables,
  STATEMENT_KINDS,
} from "@/lib/golden";
import type { AnswerKey } from "@/lib/eval/answer-key";
import type { FilingTable } from "@/lib/sec/filing-text";
import type { StatementKind } from "@/lib/sec/locate-statements";
import { detectScale, parseAmount } from "@/lib/sec/units";
import { compactUsd, exactUsd, SCALE_LABEL } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATEMENT_TITLE: Record<StatementKind, string> = {
  income: "Income statement",
  balance: "Balance sheet",
  cashflow: "Cash flow statement",
};

function formatValue(value: number, spec: FieldSpec): string {
  return spec.unit === "USD/shares"
    ? `$${value.toFixed(2)}`
    : compactUsd(value);
}

// Which printed cells hold an answer-key figure, keyed "row:cell", so the
// statement view can mark exactly where each graded number sits. Same
// matching rule as the answer-key audit: rounded to the statement's unit,
// sign-insensitive, EPS to the cent.
function keyCells(
  table: FilingTable,
  kind: StatementKind,
  key: AnswerKey,
): Map<string, string> {
  const scale = detectScale(table);
  const marks = new Map<string, string>();
  const specs = FIELDS.filter(
    (s) => s.statement === kind && key[s.key]?.onStatement,
  );
  table.rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      const n = parseAmount(cell);
      if (n === null) return;
      for (const spec of specs) {
        const v = key[spec.key]!.value;
        const s = spec.unit === "USD" ? scale : 1;
        const tol = spec.unit === "USD" ? scale / 2 : 0.005;
        if (Math.abs(Math.abs(n * s) - Math.abs(v)) <= tol) {
          marks.set(`${r}:${c}`, spec.label);
          return;
        }
      }
    });
  });
  return marks;
}

export default async function FilingPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = await params;
  const filing = loadGoldenSet().filings.find(
    (f) => f.ticker === ticker.toUpperCase(),
  );
  if (!filing) notFound();

  const tables = loadStatementTables(filing);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/golden" className="text-xs text-text-muted hover:text-text">
          ← golden set
        </Link>
        <div className="mt-2 flex flex-wrap items-baseline gap-3">
          <h1 className="font-mono text-lg text-accent">{filing.ticker}</h1>
          <span className="text-lg text-text">{filing.companyName}</span>
          <span className="text-sm text-text-muted">{filing.sector}</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs text-text-muted">
          <span>10-K for period ending {filing.periodEnd}</span>
          <span>filed {filing.filingDate}</span>
          <span>accession {filing.accessionNumber}</span>
          <a
            href={filing.url}
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            filing on sec.gov ↗
          </a>
          {filing.exhibits.map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              exhibit 13 ↗
            </a>
          ))}
        </div>
      </div>

      <section>
        <h2 className="mb-3 text-xs uppercase tracking-wide text-text-faint">
          answer key
        </h2>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs text-text-faint">
              <tr>
                <th className="px-4 py-2 font-normal">field</th>
                <th className="px-4 py-2 text-right font-normal">SEC value</th>
                <th className="px-4 py-2 font-normal">XBRL concept</th>
                <th className="px-4 py-2 font-normal">printed on</th>
              </tr>
            </thead>
            <tbody>
              {FIELDS.map((spec) => {
                const e = filing.answerKey[spec.key];
                return (
                  <tr key={spec.key} className="border-t border-border-soft">
                    <td className="px-4 py-2 text-text">{spec.label}</td>
                    <td
                      className="px-4 py-2 text-right font-mono text-text"
                      title={
                        e && spec.unit === "USD" ? exactUsd(e.value) : undefined
                      }
                    >
                      {e ? formatValue(e.value, spec) : "-"}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-text-muted">
                      {e?.concept ?? "not reported"}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {!e ? (
                        <span className="text-text-faint">
                          not in this filing&apos;s XBRL
                        </span>
                      ) : e.onStatement ? (
                        <span className="text-approve">
                          {e.rowLabels.join(" · ")}
                        </span>
                      ) : (
                        <span className="text-review">
                          not printed on the statement, not scored
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {STATEMENT_KINDS.map((kind) => {
        const located = filing.statements[kind];
        const table = tables?.[kind];
        const marks = table ? keyCells(table, kind, filing.answerKey) : null;
        return (
          <section key={kind}>
            <div className="mb-3 flex flex-wrap items-baseline gap-3">
              <h2 className="text-xs uppercase tracking-wide text-text-faint">
                {STATEMENT_TITLE[kind]}
              </h2>
              {located ? (
                <span className="font-mono text-xs text-text-faint">
                  table #{located.tableIndex} · score {located.score}
                  {located.runnerUpScore !== null
                    ? ` vs ${located.runnerUpScore} runner-up`
                    : ""}{" "}
                  · in {SCALE_LABEL[located.scale] ?? located.scale}
                </span>
              ) : (
                <span className="text-xs text-escalate">not located</span>
              )}
            </div>
            {table && marks ? (
              <div className="overflow-x-auto rounded-lg border border-border bg-surface">
                <table className="w-full text-xs">
                  <tbody>
                    {table.rows.map((row, r) => (
                      <tr
                        key={r}
                        className="border-t border-border-soft first:border-t-0"
                      >
                        {row.map((cell, c) => {
                          const mark = marks.get(`${r}:${c}`);
                          return (
                            <td
                              key={c}
                              title={mark}
                              className={
                                c === 0
                                  ? "px-3 py-1 text-text-muted"
                                  : `px-3 py-1 text-right font-mono whitespace-nowrap ${mark ? "bg-accent-soft text-accent" : "text-text"}`
                              }
                            >
                              {cell}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : located ? (
              <p className="text-xs text-text-faint">
                Statement preview needs the local filing cache (run{" "}
                <span className="font-mono">npm run golden:build</span>).
              </p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
