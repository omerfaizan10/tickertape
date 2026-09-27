import Link from "next/link";
import { StatCard } from "@/components/stat-card";
import { FIELDS } from "@/lib/fields";
import { loadGoldenSet, STATEMENT_KINDS } from "@/lib/golden";
import { pct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function GoldenSetPage() {
  const golden = loadGoldenSet();
  const { filings } = golden;
  const entries = filings.flatMap((f) => Object.values(f.answerKey));
  const onStatement = entries.filter((e) => e.onStatement).length;
  const sectors = new Set(filings.map((f) => f.sector));
  const viaExhibit = filings.filter((f) => f.exhibits.length > 0).length;

  const coverage = FIELDS.map((spec) => {
    const keyed = filings
      .map((f) => f.answerKey[spec.key])
      .filter((e) => e !== undefined);
    return {
      spec,
      inXbrl: keyed.length,
      onStatement: keyed.filter((e) => e.onStatement).length,
    };
  });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-medium text-text">Golden set</h1>
        <p className="mt-1 max-w-3xl text-sm text-text-muted">
          The latest 10-K from {filings.length} large US companies, with an
          answer key taken from the SEC&apos;s own XBRL data for that exact
          filing and period. A figure only counts toward scoring if it is
          actually printed on the statement the agents will read, so no one is
          graded on a number that isn&apos;t on the page.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="filings"
          value={String(filings.length)}
          sub={`${sectors.size} sectors`}
        />
        <StatCard
          label="answer key"
          value={String(entries.length)}
          sub="figures from XBRL"
        />
        <StatCard
          label="on the page"
          value={pct(onStatement, entries.length)}
          sub={`${onStatement} of ${entries.length} scoreable`}
        />
        <StatCard
          label="from exhibit 13"
          value={String(viaExhibit)}
          sub="statements outside the 10-K itself"
        />
      </div>

      <section>
        <h2 className="mb-3 text-xs uppercase tracking-wide text-text-faint">
          coverage by field
        </h2>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs text-text-faint">
              <tr>
                <th className="px-4 py-2 font-normal">field</th>
                <th className="px-4 py-2 font-normal">statement</th>
                <th className="px-4 py-2 text-right font-normal">in XBRL</th>
                <th className="px-4 py-2 text-right font-normal">on page</th>
                <th className="w-1/3 px-4 py-2 font-normal" />
              </tr>
            </thead>
            <tbody>
              {coverage.map(({ spec, inXbrl, onStatement: on }) => (
                <tr key={spec.key} className="border-t border-border-soft">
                  <td className="px-4 py-2 text-text">{spec.label}</td>
                  <td className="px-4 py-2 text-text-muted">
                    {spec.statement}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-text-muted">
                    {inXbrl}/{filings.length}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-text">
                    {on}/{inXbrl}
                  </td>
                  <td className="px-4 py-2">
                    <div className="h-1.5 rounded-full bg-surface-2">
                      <div
                        className="h-1.5 rounded-full bg-accent"
                        style={{ width: `${(on / filings.length) * 100}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-text-faint">
          Bar length is out of all {filings.length} filings. Operating income
          and total liabilities are missing for many companies because they
          simply don&apos;t report those lines (banks have no operating income).
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-xs uppercase tracking-wide text-text-faint">
          filings
        </h2>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs text-text-faint">
              <tr>
                <th className="px-4 py-2 font-normal">ticker</th>
                <th className="px-4 py-2 font-normal">company</th>
                <th className="px-4 py-2 font-normal">sector</th>
                <th className="px-4 py-2 font-normal">period end</th>
                <th className="px-4 py-2 font-normal">statements</th>
                <th className="px-4 py-2 text-right font-normal">
                  key on page
                </th>
              </tr>
            </thead>
            <tbody>
              {filings.map((f) => {
                const keyed = Object.values(f.answerKey);
                const on = keyed.filter((e) => e.onStatement).length;
                return (
                  <tr
                    key={f.ticker}
                    className="border-t border-border-soft hover:bg-surface"
                  >
                    <td className="px-4 py-2">
                      <Link
                        href={`/filings/${f.ticker}`}
                        className="font-mono text-accent hover:underline"
                      >
                        {f.ticker}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-text">{f.companyName}</td>
                    <td className="px-4 py-2 text-text-muted">{f.sector}</td>
                    <td className="px-4 py-2 font-mono text-text-muted">
                      {f.periodEnd}
                    </td>
                    <td className="px-4 py-2 text-xs text-text-muted">
                      {STATEMENT_KINDS.filter((k) => f.statements[k]).length}
                      /3
                      {f.exhibits.length > 0 ? (
                        <span className="ml-2 rounded border border-border px-1.5 py-0.5 text-text-faint">
                          EX-13
                        </span>
                      ) : null}
                    </td>
                    <td
                      className={`px-4 py-2 text-right font-mono ${on === keyed.length ? "text-text" : "text-review"}`}
                    >
                      {on}/{keyed.length}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {golden.skipped.length > 0 ? (
          <p className="mt-2 text-xs text-text-faint">
            Skipped:{" "}
            {golden.skipped.map((s) => `${s.ticker} (${s.skipped})`).join(", ")}
          </p>
        ) : null}
      </section>
    </div>
  );
}
