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

// Tables that carry a statement's rows and even its title but aren't the
// consolidated statement: parent-company-only "condensed" statements (a
// 10-K's real statements are never condensed), segment and business-line
// breakdowns, consolidating schedules that split the totals by business
// (Deere), banks' average balance sheets (Schwab), a subsidiary's
// summarized balance sheet (Citigroup), and multi-year summaries.
const NOT_CONSOLIDATED =
  /parent company|parent[- ]only|condensed|of (the )?registrant|schedule i\b|segment|consolidating|average balance|summarized|selected financial data|financial highlights|selected metrics/i;

// A primary statement has one figure column per year it presents: two for
// a balance sheet, three for income and cash flows. Consolidating
// schedules (Caterpillar) and five-year summaries (Deere) have many more.
const MAX_TYPICAL_COLUMNS = 4;

function typicalNumericColumns(table: FilingTable): number {
  const counts = table.rows
    .map((r) => r.slice(1).filter(isNumericCell).length)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  return counts.length ? counts[Math.floor(counts.length / 2)] : 0;
}

// A primary statement is long. Across the 54 golden-set filings the
// smallest real ones have 14 (income), 18 (balance) and 26 (cash flow)
// rows with figures, while summaries that reuse a statement's title -
// BlackRock's MD&A table introduced as "the consolidated statements of
// cash flows, excluding the impact of CIPs" - run about a dozen. These
// floors sit under the real minimums with margin.
const MIN_NUMERIC_ROWS: Record<StatementKind, number> = {
  income: 10,
  balance: 15,
  cashflow: 20,
};

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
  if (typicalNumericColumns(table) > MAX_TYPICAL_COLUMNS) score -= 25;
  if (numericRows < MIN_NUMERIC_ROWS[kind]) score -= 30;
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

// A statement that runs past a page break often continues in the next
// table with nothing above it but a page number (Citigroup's income
// statement puts EPS there; J&J's cash flow statement puts financing
// activities there). A following table whose heading has no words in it
// is part of the same statement, so it's folded back in.
const MAX_CONTINUATIONS = 2;

function isContinuation(table: FilingTable): boolean {
  const heading = table.heading.replace(/table of contents/gi, "");
  return !/[a-z]{3,}/i.test(heading);
}

export function locateStatement(
  tables: FilingTable[],
  kind: StatementKind,
): { table: FilingTable; candidate: Candidate; runnerUp: Candidate | null } | null {
  const [best, runnerUp] = rankCandidates(tables, kind, 2);
  if (!best) return null;
  const rows = [...best.table.rows];
  for (let i = 1; i <= MAX_CONTINUATIONS; i++) {
    const next = tables[best.table.index + i];
    if (!next || !isContinuation(next)) break;
    rows.push(...next.rows);
  }
  return {
    table: { ...best.table, rows },
    candidate: best,
    runnerUp: runnerUp ?? null,
  };
}
