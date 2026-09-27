import { FIELDS } from "@/lib/fields";
import type { ExtractedFigure } from "@/lib/agent/types";
import { compactUsd, exactUsd, SCALE_LABEL } from "@/lib/format";

// Every extracted figure with its provenance: the row it came from, what
// was printed there, and the unit that turned it into a number. When an
// expected value is supplied (golden-set runs), each figure is also marked
// right or wrong against the SEC's.
export function FiguresTable({
  figures,
  expected,
}: {
  figures: ExtractedFigure[];
  expected?: Partial<Record<string, { value: number; onStatement: boolean }>>;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface text-left text-xs text-text-faint">
          <tr>
            <th className="px-4 py-2 font-normal">field</th>
            <th className="px-4 py-2 text-right font-normal">value</th>
            <th className="px-4 py-2 font-normal">statement row</th>
            <th className="px-4 py-2 text-right font-normal">printed</th>
            {expected ? (
              <th className="px-4 py-2 text-right font-normal">SEC</th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {FIELDS.map((spec) => {
            const f = figures.find((x) => x.field === spec.key);
            const exp = expected?.[spec.key];
            const tol = spec.unit === "USD" ? (f?.scale ?? 1) / 2 : 0.005;
            const verdict =
              !exp?.onStatement || !f
                ? null
                : f.value !== null &&
                    Math.abs(f.value - exp.value) <= tol
                  ? "right"
                  : "wrong";
            return (
              <tr key={spec.key} className="border-t border-border-soft align-top">
                <td className="px-4 py-2 text-text">{spec.label}</td>
                <td
                  className="px-4 py-2 text-right font-mono text-text"
                  title={
                    f?.value != null && spec.unit === "USD"
                      ? exactUsd(f.value)
                      : undefined
                  }
                >
                  {f?.value == null
                    ? "-"
                    : spec.unit === "USD"
                      ? compactUsd(f.value)
                      : `$${f.value.toFixed(2)}`}
                </td>
                <td className="px-4 py-2 text-xs">
                  {f?.rowIndex != null ? (
                    <span className="text-text-muted">
                      <span className="font-mono text-text-faint">
                        R{f.rowIndex}
                      </span>{" "}
                      {f.rowLabel}
                    </span>
                  ) : (
                    <span className="text-text-faint">
                      not printed on this statement
                    </span>
                  )}
                  {f?.groundingMismatch ? (
                    <div className="mt-0.5 text-review">
                      agent read {f.agentPrinted}; the cell says {f.printed}
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs text-text-muted">
                  {f?.printed ?? "-"}
                  {f?.printed && spec.unit === "USD" ? (
                    <span className="text-text-faint">
                      {" "}
                      {SCALE_LABEL[f.scale] === "dollars"
                        ? ""
                        : SCALE_LABEL[f.scale]}
                    </span>
                  ) : null}
                </td>
                {expected ? (
                  <td className="px-4 py-2 text-right font-mono text-xs">
                    {exp ? (
                      <span
                        className={
                          verdict === "right"
                            ? "text-approve"
                            : verdict === "wrong"
                              ? "text-escalate"
                              : "text-text-faint"
                        }
                        title={
                          exp.onStatement
                            ? undefined
                            : "not printed on the statement, not graded"
                        }
                      >
                        {spec.unit === "USD"
                          ? compactUsd(exp.value)
                          : `$${exp.value.toFixed(2)}`}
                        {verdict === "right" ? " ✓" : verdict === "wrong" ? " ✗" : ""}
                      </span>
                    ) : (
                      <span className="text-text-faint">-</span>
                    )}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
