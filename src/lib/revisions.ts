import { FIELDS, type FieldKey } from "./fields";
import type { ExtractedFigure } from "./agent/types";
import { figureAt, rowKey } from "./agent/statement-view";
import type { FilingTable } from "./sec/filing-text";
import type { StatementKind } from "./sec/locate-statements";
import { detectScale, parseAmount } from "./sec/units";

// Restatement detection from the filings alone. This year's 10-K reprints
// last year's figures; last year's 10-K reported them originally. The
// pipeline reads both, so comparing them is arithmetic: anything more than
// rounding apart was revised after it was first reported.

export interface Revision {
  field: FieldKey;
  original: number;
  reprinted: number;
  delta: number;
  pct: number | null;
  revised: boolean;
  // The rows each figure came from, so a reader can check both by hand.
  originalRow: string | null;
  reprintedRow: string | null;
  // Set when the agents picked different lines in the two years and the
  // comparison was redone on last year's copy of this year's line.
  realigned: boolean;
}

type StatementTables = Partial<
  Record<StatementKind, { table: FilingTable; column: number }>
>;

// Comparing two different lines is not a restatement. In the eval, every
// false alarm was the agents picking different rows in the two years:
// "Sales and other operating revenues" one year, "Total revenues and other
// income" the next (ConocoPhillips); continuing-operations EPS one year,
// total EPS the next (Duke). So when the rows differ, last year's copy of
// this year's line - same label under the same section header - is found
// by code and compared instead.
function realign(
  now: ExtractedFigure,
  then: ExtractedFigure,
  statement: StatementKind,
  tables: { current: StatementTables; prior: StatementTables },
): { value: number; row: string } | null {
  const cur = tables.current[statement];
  const pri = tables.prior[statement];
  if (!cur || !pri || now.rowIndex === null || then.rowIndex === null) {
    return null;
  }
  const key = rowKey(cur.table, now.rowIndex, cur.column);
  if (rowKey(pri.table, then.rowIndex, pri.column) === key) return null;
  const match = pri.table.rows.findIndex(
    (r, i) =>
      rowKey(pri.table, i, pri.column) === key &&
      figureAt(r, pri.column) !== null,
  );
  if (match === -1) return null;
  const printed = figureAt(pri.table.rows[match], pri.column);
  const amount = printed ? parseAmount(printed) : null;
  if (amount === null) return null;
  const scale =
    FIELDS.find((f) => f.key === now.field)?.unit === "USD/shares"
      ? 1
      : detectScale(pri.table);
  return { value: amount * scale, row: pri.table.rows[match][0] };
}

export function compareWithPriorFiling(
  current: ExtractedFigure[],
  prior: ExtractedFigure[],
  tables?: { current: StatementTables; prior: StatementTables },
): Revision[] {
  const out: Revision[] = [];
  for (const spec of FIELDS) {
    const now = current.find((f) => f.field === spec.key);
    const then = prior.find((f) => f.field === spec.key);
    if (now?.priorValue == null || then?.value == null) continue;
    // A figure that failed a consistency check is not trustworthy enough to
    // accuse a company of restating anything.
    if (now.failedChecks.length > 0 || then.failedChecks.length > 0) continue;
    // Each figure is rounded to its own statement's unit, and a company can
    // change units between years (thousands to millions), so the tolerance
    // is half a unit of the coarser one. EPS is printed to the cent.
    const tolerance =
      spec.unit === "USD/shares" ? 0.005 : Math.max(now.scale, then.scale) / 2;
    let original = then.value;
    let originalRow = then.rowLabel;
    let realigned = false;
    if (Math.abs(now.priorValue - original) > tolerance && tables) {
      const aligned = realign(now, then, spec.statement, tables);
      if (aligned) {
        original = aligned.value;
        originalRow = aligned.row;
        realigned = true;
      }
    }
    const delta = now.priorValue - original;
    out.push({
      field: spec.key,
      original,
      reprinted: now.priorValue,
      delta,
      pct: original === 0 ? null : (delta / Math.abs(original)) * 100,
      revised: Math.abs(delta) > tolerance,
      originalRow,
      reprintedRow: now.rowLabel,
      realigned,
    });
  }
  return out;
}
