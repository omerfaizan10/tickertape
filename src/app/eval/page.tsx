import Link from "next/link";
import { StatCard } from "@/components/stat-card";
import { FIELDS } from "@/lib/fields";
import { isCorrect, loadEvalReport } from "@/lib/eval-report";
import { compactUsd, pct } from "@/lib/format";

export const dynamic = "force-dynamic";

const OUTCOME_LABEL: Record<string, string> = {
  wrong_value: "wrong row",
  wrong_sign: "wrong sign",
  missing: "said not printed",
};

const CHECK_LABEL: Record<string, string> = {
  row_has_figure: "picked row prints a figure",
  balance_identity: "assets = liabilities + equity",
  totalEquity_attribution: "equity excludes minority interests",
  netIncome_attribution: "net income excludes minority interests",
  netIncome_before_preferred: "net income before preferred dividends",
  epsDiluted_total: "diluted EPS is for total net income",
  cash_flow_tie: "cash flows tie to the change in cash",
};

function Bar({ value }: { value: number }) {
  return (
    <div className="h-1.5 rounded-full bg-surface-2">
      <div
        className="h-1.5 rounded-full bg-accent"
        style={{ width: `${value * 100}%` }}
      />
    </div>
  );
}

export default function EvalPage() {
  const report = loadEvalReport();
  if (!report) {
    return (
      <p className="text-sm text-text-muted">
        No eval has been run yet. Run{" "}
        <span className="font-mono">npm run eval</span>.
      </p>
    );
  }
  const { graded, runs } = report;
  const correct = graded.filter(isCorrect).length;
  const cost = runs.reduce((s, r) => s + r.costUsd, 0);
  const latency = runs.reduce((s, r) => s + r.latencyMs, 0) / runs.length;
  const retried = runs.filter((r) => r.retryCount > 0).length;
  const grounding = graded.filter((g) => g.groundingMismatch).length;
  const misses = graded.filter((g) => !isCorrect(g));
  const checks = runs.flatMap((r) => r.checks).filter((c) => !c.skipped);
  const sectors = [...new Set(graded.map((g) => g.sector))];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-medium text-text">Evaluation</h1>
        <p className="mt-1 max-w-3xl text-sm text-text-muted">
          The full pipeline run on every golden-set filing, each extracted
          figure graded against the SEC&apos;s XBRL value for that exact filing
          and period. Model <span className="font-mono">{report.model}</span>,
          prompt <span className="font-mono">{report.promptVersion}</span>, run{" "}
          {report.runAt.slice(0, 10)}.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="figure accuracy"
          value={pct(correct, graded.length)}
          sub={`${correct} of ${graded.length} exact, sign included`}
        />
        <StatCard
          label="cost per filing"
          value={`$${(cost / runs.length).toFixed(4)}`}
          sub={`$${cost.toFixed(2)} for all ${runs.length}`}
        />
        <StatCard
          label="time per filing"
          value={`${(latency / 1000).toFixed(1)}s`}
          sub="three agents in parallel"
        />
        <StatCard
          label="misread figures"
          value={String(grounding)}
          sub={`${retried} of ${runs.length} filings retried once`}
        />
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        <section>
          <h2 className="mb-3 text-xs uppercase tracking-wide text-text-faint">
            by field
          </h2>
          <table className="w-full text-sm">
            <tbody>
              {FIELDS.map((spec) => {
                const g = graded.filter((x) => x.field === spec.key);
                const c = g.filter(isCorrect).length;
                return (
                  <tr key={spec.key} className="border-t border-border-soft">
                    <td className="py-1.5 pr-3 text-text-muted">
                      {spec.label}
                    </td>
                    <td className="w-24 py-1.5 pr-3">
                      <Bar value={g.length ? c / g.length : 0} />
                    </td>
                    <td className="py-1.5 text-right font-mono text-xs text-text">
                      {c}/{g.length}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
        <section>
          <h2 className="mb-3 text-xs uppercase tracking-wide text-text-faint">
            by sector
          </h2>
          <table className="w-full text-sm">
            <tbody>
              {sectors.map((s) => {
                const g = graded.filter((x) => x.sector === s);
                const c = g.filter(isCorrect).length;
                return (
                  <tr key={s} className="border-t border-border-soft">
                    <td className="py-1.5 pr-3 text-text-muted">{s}</td>
                    <td className="w-24 py-1.5 pr-3">
                      <Bar value={c / g.length} />
                    </td>
                    <td className="py-1.5 text-right font-mono text-xs text-text">
                      {c}/{g.length}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <h2 className="mb-3 mt-6 text-xs uppercase tracking-wide text-text-faint">
            reconciliation checks, after retries
          </h2>
          <table className="w-full text-sm">
            <tbody>
              {[...new Set(checks.map((c) => c.name))].map((name) => {
                const c = checks.filter((x) => x.name === name);
                const p = c.filter((x) => x.passed).length;
                return (
                  <tr key={name} className="border-t border-border-soft">
                    <td className="py-1.5 pr-3 text-text-muted">
                      {CHECK_LABEL[name] ?? name}
                    </td>
                    <td className="py-1.5 text-right font-mono text-xs text-text">
                      {p}/{c.length}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-text-faint">
            The cash flow tie breaks on legitimate extra lines (discontinued
            operations, restricted cash), so it&apos;s reported but never
            triggers a retry.
          </p>
        </section>
      </div>

      <section>
        <h2 className="mb-3 text-xs uppercase tracking-wide text-text-faint">
          every miss
        </h2>
        {misses.length === 0 ? (
          <p className="text-sm text-text-muted">None.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface text-left text-xs text-text-faint">
                <tr>
                  <th className="px-4 py-2 font-normal">filing</th>
                  <th className="px-4 py-2 font-normal">field</th>
                  <th className="px-4 py-2 font-normal">what happened</th>
                  <th className="px-4 py-2 text-right font-normal">SEC</th>
                  <th className="px-4 py-2 text-right font-normal">got</th>
                  <th className="px-4 py-2 font-normal">
                    row picked / correct row
                  </th>
                </tr>
              </thead>
              <tbody>
                {misses.map((m, i) => {
                  const spec = FIELDS.find((f) => f.key === m.field)!;
                  const fmt = (v: number | null) =>
                    v === null
                      ? "-"
                      : spec.unit === "USD"
                        ? compactUsd(v)
                        : `$${v.toFixed(2)}`;
                  return (
                    <tr
                      key={i}
                      className="border-t border-border-soft align-top"
                    >
                      <td className="px-4 py-2">
                        <Link
                          href={`/filings/${m.ticker}`}
                          className="font-mono text-accent hover:underline"
                        >
                          {m.ticker}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-text">{spec.label}</td>
                      <td className="px-4 py-2 text-xs text-review">
                        {OUTCOME_LABEL[m.outcome] ?? m.outcome}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-text">
                        {fmt(m.expected)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-text-muted">
                        {fmt(m.actual)}
                      </td>
                      <td className="px-4 py-2 text-xs text-text-muted">
                        {m.rowLabel ?? "-"}
                        <span className="text-text-faint">
                          {" "}
                          / {m.expectedRows.join(" · ")}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
