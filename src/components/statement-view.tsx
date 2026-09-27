import type { FilingTable } from "@/lib/sec/filing-text";
import { parseAmount } from "@/lib/sec/units";

// A located statement as printed, with the exact cells the agents' figures
// came from highlighted. Figures count from the first cell after the label
// (or from the first cell, for Merck-style unlabeled total rows), matching
// how the pipeline reads a row.
export function StatementView({
  table,
  column,
  marks,
}: {
  table: FilingTable;
  column: number;
  marks: Map<number, string>;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full text-xs">
        <tbody>
          {table.rows.map((row, r) => {
            const labeled = parseAmount(row[0]) === null;
            let figureIndex = -1;
            const mark = marks.get(r);
            return (
              <tr
                key={r}
                className={`border-t border-border-soft first:border-t-0 ${mark ? "bg-accent-soft/40" : ""}`}
              >
                <td className="w-8 px-2 py-1 text-right font-mono text-text-faint">
                  {r}
                </td>
                {row.map((cell, c) => {
                  const isLabel = c === 0 && labeled;
                  if (!isLabel && (parseAmount(cell) !== null || /^[-\u2014\u2013]$/.test(cell))) {
                    figureIndex++;
                  }
                  const picked = mark && !isLabel && figureIndex === column && parseAmount(cell) !== null;
                  return (
                    <td
                      key={c}
                      title={picked ? mark : undefined}
                      className={
                        isLabel
                          ? `px-3 py-1 ${mark ? "text-text" : "text-text-muted"}`
                          : `whitespace-nowrap px-3 py-1 text-right font-mono ${picked ? "rounded bg-accent text-bg" : "text-text"}`
                      }
                    >
                      {cell}
                      {isLabel && mark ? (
                        <span className="ml-2 text-accent">← {mark}</span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
