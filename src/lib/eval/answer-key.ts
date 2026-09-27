import type { FilingTable } from "../sec/filing-text";
import { detectScale, parseAmount } from "../sec/units";
import type { FieldKey, FieldSpec } from "../fields";

// Builds the answer key for one filing from the SEC's XBRL data. This is
// the only place outside the eval harness that touches XBRL - nothing
// under src/lib/agent may import from src/lib/eval.

interface XbrlFact {
  start?: string;
  end: string;
  val: number;
  accn: string;
  form: string;
}

export interface CompanyFacts {
  facts: Record<string, Record<string, { units: Record<string, XbrlFact[]> }>>;
}

export interface AnswerKeyEntry {
  value: number;
  concept: string;
  // True when the value is printed on the located statement itself. Only
  // these are scored: an agent can't be graded on a number that isn't on
  // the page it was given.
  onStatement: boolean;
  // Every statement row printing this value, for inspection. Usually one;
  // more when two lines happen to share a figure (AT&T's depreciation and
  // its investing cash flow) or basic and diluted EPS round to the same
  // cent.
  rowLabels: string[];
  // Other values the SEC also tags for this field that are printed on the
  // same statement. Revenue is the real case: Walmart tags both "Revenues"
  // (total revenues, $713B) and revenue from contracts with customers (net
  // sales, $706B), and both lines are on its income statement. When the
  // SEC's own data has two valid answers on the page, either one counts.
  alternates: number[];
}

export type AnswerKey = Partial<Record<FieldKey, AnswerKeyEntry>>;

const ANNUAL_MIN_DAYS = 330;
const ANNUAL_MAX_DAYS = 400;

function days(start: string, end: string): number {
  return (Date.parse(end) - Date.parse(start)) / 86400000;
}

// One value for this concept in this filing, for this period. A 10-K also
// reports prior years for comparison, so the period end has to match, and
// flow items need a full-year duration (quarterly facts share the end
// date). If the filing somehow reports two different values for the same
// slot, there is no single right answer, so nothing is returned.
function factFor(
  facts: CompanyFacts,
  concept: string,
  spec: FieldSpec,
  accn: string,
  periodEnd: string,
): number | null {
  const list = facts.facts["us-gaap"]?.[concept]?.units?.[spec.unit] ?? [];
  const values = new Set(
    list
      .filter(
        (f) =>
          f.accn === accn &&
          f.end === periodEnd &&
          (spec.duration
            ? f.start !== undefined &&
              days(f.start, f.end) >= ANNUAL_MIN_DAYS &&
              days(f.start, f.end) <= ANNUAL_MAX_DAYS
            : f.start === undefined),
      )
      .map((f) => f.val),
  );
  return values.size === 1 ? [...values][0] : null;
}

// Finds the rows printing this value. Figures are rounded to the
// statement's unit, and EPS is printed to the cent.
export function findOnStatement(
  table: FilingTable,
  value: number,
  unit: FieldSpec["unit"],
): string[] {
  const labels: string[] = [];
  const scale = unit === "USD" ? detectScale(table) : 1;
  const tolerance = unit === "USD" ? scale / 2 : 0.005;
  for (const row of table.rows) {
    // Some statements print total rows with no label at all, just the
    // figures under a rule line (Merck's total assets), so a row whose
    // first cell is already a number has no label to skip.
    const labeled = parseAmount(row[0]) === null;
    for (const cell of labeled ? row.slice(1) : row) {
      const n = parseAmount(cell);
      if (n === null) continue;
      // Some statements print outflows without parentheses and label the
      // line instead ("Cash used in investing activities"), so the sign is
      // not part of the match.
      if (Math.abs(Math.abs(n * scale) - Math.abs(value)) <= tolerance) {
        labels.push(labeled ? row[0] : "(unlabeled total row)");
        break;
      }
    }
  }
  return labels;
}

export function buildAnswerKey(
  facts: CompanyFacts,
  specs: FieldSpec[],
  statements: Partial<Record<FieldSpec["statement"], FilingTable>>,
  accn: string,
  periodEnd: string,
): AnswerKey {
  const key: AnswerKey = {};
  for (const spec of specs) {
    const table = statements[spec.statement];
    let fallback: AnswerKeyEntry | null = null;
    const onPage: AnswerKeyEntry[] = [];
    for (const concept of spec.concepts) {
      const value = factFor(facts, concept, spec, accn, periodEnd);
      if (value === null) continue;
      const rowLabels = table ? findOnStatement(table, value, spec.unit) : [];
      const entry: AnswerKeyEntry = {
        value,
        concept,
        onStatement: rowLabels.length > 0,
        rowLabels,
        alternates: [],
      };
      if (entry.onStatement) onPage.push(entry);
      else fallback ??= entry;
    }
    if (onPage.length > 0) {
      const [primary, ...rest] = onPage;
      primary.alternates = [...new Set(rest.map((e) => e.value))].filter(
        (v) => v !== primary.value,
      );
      key[spec.key] = primary;
      continue;
    }
    if (fallback) key[spec.key] = fallback;
  }
  return key;
}
