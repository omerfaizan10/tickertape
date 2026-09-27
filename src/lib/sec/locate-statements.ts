import type { FilingTable } from "./filing-text";

// Finds the three primary financial statements among the hundreds of
// tables in a 10-K. A statement's title shows up dozens of times (table of
// contents, cross-references, page headers), so the title alone can't pick
// the table. Instead every table is scored on things the real statement
// has and the lookalikes don't: its title right above it, the rows every
// such statement must contain, and enough numeric rows to be a statement
// rather than a one-line summary. This is plain code on purpose - it's
// cheap, deterministic, and testable, and a model is only needed to break
// a close call between the top candidates.

export type StatementKind = "income" | "balance" | "cashflow";

interface StatementSignature {
  title: RegExp;
  // Rows the statement is required to have; each one found adds score.
  mustRows: RegExp[];
  // Titles of lookalike tables that share the required rows but aren't
  // this statement (comprehensive income also has a net income line).
  lookalike?: RegExp;
}

const SIGNATURES: Record<StatementKind, StatementSignature> = {
  income: {
    title:
      /statements? of (consolidated )?(income|operations|earnings)|income statements?/i,
    mustRows: [
      /^(total )?(net )?(revenues?|sales)|^total net sales|^net sales/i,
      /^net (income|earnings|loss)/i,
      /per (common )?share|^(basic|diluted)/i,
    ],
    lookalike: /comprehensive income/i,
  },
  balance: {
    title:
      /balance sheets?|statements? of (consolidated )?financial (position|condition)/i,
    mustRows: [
      /^total assets/i,
      /^total liabilities/i,
      /(stockholders|shareholders|shareowners)['’]? equity|^total equity/i,
    ],
  },
  cashflow: {
    title: /statements? of (consolidated )?cash flows?/i,
    mustRows: [
      /operating activities/i,
      /investing activities/i,
      /financing activities/i,
    ],
  },
};

// Statements from a parent-company-only schedule or a segment breakdown
// look like the real thing but aren't the consolidated figures.
const NOT_CONSOLIDATED =
  /parent company|condensed (financial|statements?) of (the )?registrant|schedule i\b|segment/i;

const MIN_NUMERIC_ROWS = 8;

function isNumericCell(c: string): boolean {
  return /^\(?-?[\d,]+(\.\d+)?\)?%?$/.test(c) && /\d/.test(c);
}

export interface Candidate {
  table: FilingTable;
  score: number;
  numericRows: number;
  rowsMatched: number;
}

export function scoreTable(table: FilingTable, kind: StatementKind): Candidate {
  const sig = SIGNATURES[kind];
  const labels = table.rows.map((r) => r[0] ?? "");
  const numericRows = table.rows.filter((r) =>
    r.slice(1).some(isNumericCell),
  ).length;
  const rowsMatched = sig.mustRows.filter((re) =>
    labels.some((l) => re.test(l)),
  ).length;

  let score = rowsMatched * 10;
  if (sig.title.test(table.heading)) score += 15;
  if (NOT_CONSOLIDATED.test(table.heading)) score -= 40;
  if (sig.lookalike?.test(table.heading)) score -= 40;
  if (numericRows < MIN_NUMERIC_ROWS) score -= 30;
  score += Math.min(numericRows, 40) * 0.25;

  return { table, score, numericRows, rowsMatched };
}

export function rankCandidates(
  tables: FilingTable[],
  kind: StatementKind,
  top = 3,
): Candidate[] {
  return tables
    .map((t) => scoreTable(t, kind))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.table.index - b.table.index)
    .slice(0, top);
}
