import Link from "next/link";
import { StatCard } from "@/components/stat-card";
import { isCorrect, loadEvalReport } from "@/lib/eval-report";
import { loadGoldenSet } from "@/lib/golden";
import { pct } from "@/lib/format";

export const dynamic = "force-dynamic";

const PIPELINE: { name: string; kind: "code" | "agent"; what: string }[] = [
  {
    name: "Locator",
    kind: "code",
    what: "Pulls the 10-K (and any Exhibit 13 annual report) from EDGAR, strips every XBRL tag, and scores every table to find the three primary statements.",
  },
  {
    name: "Three statement agents",
    kind: "agent",
    what: "Run in parallel, one per statement. Each reads its statement as numbered rows and names the row holding each figure. That's the only judgment in the pipeline.",
  },
  {
    name: "Reader",
    kind: "code",
    what: "Takes the current-period cell from the named row, applies the statement's units and sign, and flags any figure the agent misreported.",
  },
  {
    name: "Reconciler",
    kind: "code",
    what: "Checks the picks against the statements' own printed totals. A failed check re-runs only the agent it implicates, once, told exactly what failed.",
  },
];

export default function OverviewPage() {
  const golden = loadGoldenSet();
  const report = loadEvalReport();
  const correct = report ? report.graded.filter(isCorrect).length : 0;
  const cost = report ? report.runs.reduce((s, r) => s + r.costUsd, 0) : 0;
  const keyed = golden.filings.flatMap((f) => Object.values(f.answerKey));
  const onPage = keyed.filter((e) => e.onStatement).length;

  return (
    <div className="flex flex-col gap-10">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-medium tracking-tight text-text">
          Agents that read 10-Ks, graded by the SEC.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-text-muted">
          Every public company files its financial statements twice: once as the
          human-readable 10-K, and once as structured XBRL data. Tickertape has
          agents read the first and grades them against the second, for the
          exact same filing. The agents never see the XBRL. It&apos;s the answer
          key.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/analyze"
            className="rounded border border-accent/40 bg-accent-soft px-4 py-1.5 text-sm text-accent transition-colors hover:bg-accent/20"
          >
            analyze a ticker
          </Link>
          <Link
            href="/eval"
            className="rounded border border-border px-4 py-1.5 text-sm text-text-muted transition-colors hover:border-accent hover:text-text"
          >
            see every graded figure
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="figure accuracy"
          value={report ? pct(correct, report.graded.length) : "-"}
          sub={
            report
              ? `${correct} of ${report.graded.length} vs SEC XBRL`
              : "no eval run yet"
          }
        />
        <StatCard
          label="golden set"
          value={String(golden.filings.length)}
          sub="latest 10-Ks, 7 sectors"
        />
        <StatCard
          label="answer key on the page"
          value={pct(onPage, keyed.length)}
          sub={`${onPage} of ${keyed.length} XBRL figures printed`}
        />
        <StatCard
          label="cost per filing"
          value={report ? `$${(cost / report.runs.length).toFixed(4)}` : "-"}
          sub={report ? report.model : ""}
        />
      </div>

      <section>
        <h2 className="mb-4 text-xs uppercase tracking-wide text-text-faint">
          the pipeline
        </h2>
        <ol className="grid gap-3 md:grid-cols-4">
          {PIPELINE.map((step, i) => (
            <li
              key={step.name}
              className="rounded-lg border border-border bg-surface p-4"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm text-text">
                  <span className="mr-2 font-mono text-text-faint">
                    {i + 1}
                  </span>
                  {step.name}
                </span>
                <span
                  className={`font-mono text-[10px] uppercase tracking-wide ${step.kind === "agent" ? "text-accent" : "text-text-faint"}`}
                >
                  {step.kind}
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-text-muted">
                {step.what}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="max-w-3xl">
        <h2 className="mb-3 text-xs uppercase tracking-wide text-text-faint">
          why grade this way
        </h2>
        <ul className="flex flex-col gap-2 text-sm leading-relaxed text-text-muted">
          <li>
            <span className="text-text">
              The answer key is the SEC&apos;s, not mine.
            </span>{" "}
            Every graded figure is the company&apos;s own XBRL value for that
            filing and period, and only figures actually printed on the
            statement count, so an agent is never graded on a number that
            isn&apos;t on the page.
          </li>
          <li>
            <span className="text-text">It refreshes itself.</span> Any new 10-K
            comes with its XBRL, so the golden set can include filings made
            after a model&apos;s training cutoff. Nothing to memorize.
          </li>
          <li>
            <span className="text-text">
              Finding and reading are graded apart.
            </span>{" "}
            Locating the statement is deterministic code, checked separately, so
            an accuracy number here measures reading, not retrieval luck.
          </li>
          <li>
            <span className="text-text">Every figure is traceable.</span> Each
            one links to the exact printed cell it came from, and code, not a
            model, checks that the figures add up.
          </li>
        </ul>
      </section>
    </div>
  );
}
