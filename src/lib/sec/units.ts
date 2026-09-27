import type { FilingTable } from "./filing-text";

// Statements print figures scaled ("In millions") with negatives in
// parentheses. Turning a printed cell into a real number is arithmetic,
// not judgment, so it lives here in code for both the pipeline and the
// eval to share, instead of being left to a model.

const UNIT_SCALE: Record<string, number> = {
  thousands: 1e3,
  millions: 1e6,
  billions: 1e9,
};

// The unit statement ("In millions") sits above the figures: in the
// heading, or in the table's own header rows before the first row with a
// number in it (Wells Fargo's is a few rows down). When a statement
// mentions two ("In millions, except number of shares, which are
// reflected in thousands"), the first one is the unit for the dollar
// figures, and the exceptions come after it.
export function detectScale(table: FilingTable): number {
  const firstFigureRow = table.rows.findIndex((r) =>
    r.slice(1).some((c) => parseAmount(c) !== null && !/^(19|20)\d{2}$/.test(c)),
  );
  const headerRows = table.rows.slice(
    0,
    firstFigureRow === -1 ? table.rows.length : firstFigureRow,
  );
  const text = `${table.heading} ${headerRows.flat().join(" ")}`;
  const unit =
    text.match(/\b(thousands|millions|billions)\b/i)?.[1] ?? table.documentUnit;
  return unit ? UNIT_SCALE[unit.toLowerCase()] : 1;
}

// "1,234" -> 1234, "(1,234)" -> -1234, "6.08" -> 6.08. Anything that
// isn't a plain printed figure (dashes, footnote markers, words) is null.
export function parseAmount(cell: string): number | null {
  const c = cell.replace(/\s/g, "");
  const m = c.match(/^(\()?-?([\d,]+(?:\.\d+)?)\)?$/);
  if (!m) return null;
  const n = Number(m[2].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return m[1] || c.startsWith("-") ? -n : n;
}
