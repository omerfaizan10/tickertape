import { FIELDS } from "@/lib/fields";
import type { PriorYearCheck } from "@/lib/agent/types";
import { compactUsd } from "@/lib/format";

const CAUSE_LABEL: Record<string, string> = {
  discontinued_operations: "discontinued operations",
  accounting_change: "accounting change",
  reclassification: "reclassification",
  error_correction: "error correction",
  acquisition_or_divestiture: "acquisition or divestiture",
  unexplained: "not explained in the filing",
};

// Last year's figures as this filing reprints them vs. as last year's 10-K
// originally reported them. A correction of an error is the one cause that
// matters most to a reader, so it's the only one shown in the alarm color.
export function RevisionsPanel({ check }: { check: PriorYearCheck }) {
  const revised = check.revisions.filter((r) => r.revised);
  const fmt = (field: string, v: number) =>
    FIELDS.find((f) => f.key === field)?.unit === "USD/shares"
      ? `$${v.toFixed(2)}`
      : compactUsd(v);
  const label = (field: string) =>
    FIELDS.find((f) => f.key === field)?.label ?? field;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        {revised.length === 0 ? (
          <>
            All {check.revisions.length} of last year&apos;s figures are
            reprinted exactly as the {check.priorPeriodEnd.slice(0, 4)} 10-K
            first reported them. Nothing was restated.
          </>
        ) : (
          <>
            <span className="text-review">
              {revised.length} of {check.revisions.length}
            </span>{" "}
            of last year&apos;s figures are reprinted differently from how the{" "}
            {check.priorPeriodEnd.slice(0, 4)} 10-K first reported them.
          </>
        )}
      </p>

      {revised.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs text-text-faint">
              <tr>
                <th className="px-4 py-2 font-normal">figure</th>
                <th className="px-4 py-2 text-right font-normal">
                  first reported
                </th>
                <th className="px-4 py-2 text-right font-normal">
                  reprinted now
                </th>
                <th className="px-4 py-2 text-right font-normal">change</th>
              </tr>
            </thead>
            <tbody>
              {revised.map((r) => (
                <tr key={r.field} className="border-t border-border-soft">
                  <td className="px-4 py-2 text-text">
                    {label(r.field)}
                    {r.realigned ? (
                      <span
                        className="ml-2 text-xs text-text-faint"
                        title="The agents read different lines in the two years; the comparison uses last year's copy of this year's line."
                      >
                        same line matched by label
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-text-muted">
                    {fmt(r.field, r.original)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-text">
                    {fmt(r.field, r.reprinted)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-review">
                    {r.pct === null
                      ? "-"
                      : `${r.pct > 0 ? "+" : ""}${r.pct.toFixed(2)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {check.explanations.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {check.explanations.map((e, i) => (
            <li
              key={i}
              className="rounded-lg border border-border-soft bg-surface p-3"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${
                    e.cause === "error_correction"
                      ? "bg-escalate-soft text-escalate"
                      : "bg-surface-2 text-text-muted"
                  }`}
                >
                  {CAUSE_LABEL[e.cause] ?? e.cause}
                </span>
                <span className="text-xs text-text-faint">
                  {e.fields.map(label).join(", ")}
                </span>
              </div>
              <p className="mt-2 text-sm text-text">{e.summary}</p>
              {e.verified && e.quote ? (
                <blockquote className="mt-2 border-l-2 border-accent/50 pl-3 text-xs italic text-text-muted">
                  &ldquo;{e.quote}&rdquo;
                  <span className="ml-2 not-italic text-approve">
                    quote found in the filing
                  </span>
                </blockquote>
              ) : (
                <p className="mt-2 text-xs text-text-faint">
                  No quote from the filing could be verified for this
                  explanation, so treat it as unconfirmed.
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
