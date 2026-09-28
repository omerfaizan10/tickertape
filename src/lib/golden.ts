import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import type { AnswerKey } from "./eval/answer-key";
import type { RevisionTruth } from "./eval/revisions-truth";
import type { FieldKey } from "./fields";
import { parseFiling, type FilingTable } from "./sec/filing-text";
import { locateStatement, type StatementKind } from "./sec/locate-statements";

export interface LocatedStatement {
  tableIndex: number;
  score: number;
  runnerUpScore: number | null;
  scale: number;
}

export interface GoldenFiling {
  ticker: string;
  sector: string;
  cik: number;
  companyName: string;
  accessionNumber: string;
  periodEnd: string;
  filingDate: string;
  url: string;
  // Exhibit 13 documents the statements were incorporated from, when the
  // 10-K itself doesn't contain them.
  exhibits: string[];
  statements: Partial<Record<StatementKind, LocatedStatement>>;
  answerKey: AnswerKey;
  // The 10-K before this one, whose figures this one reprints for
  // comparison, and per field whether the reprint differs from what that
  // filing originally reported.
  priorFiling: {
    accessionNumber: string;
    periodEnd: string;
    filingDate: string;
    url: string;
  } | null;
  revisions: Partial<Record<FieldKey, RevisionTruth>>;
}

export interface GoldenSet {
  builtAt: string;
  filings: GoldenFiling[];
  skipped: { ticker: string; skipped: string }[];
}

export const STATEMENT_KINDS: StatementKind[] = [
  "income",
  "balance",
  "cashflow",
];

const GOLDEN_PATH = join(process.cwd(), "data", "golden", "golden-set.json");
const CACHE_DIR = join(process.cwd(), "data", "cache");

export function loadGoldenSet(): GoldenSet {
  return JSON.parse(readFileSync(GOLDEN_PATH, "utf-8"));
}

// The located statement tables themselves, for showing each answer-key
// figure where it sits on the page. Only available where the builder's
// download cache exists (it's gitignored), so callers must handle null.
export function loadStatementTables(
  filing: GoldenFiling,
): Partial<Record<StatementKind, FilingTable>> | null {
  if (!existsSync(CACHE_DIR)) return null;
  const docs = readdirSync(CACHE_DIR)
    .filter(
      (f) =>
        f.startsWith(`${filing.ticker}-${filing.accessionNumber}`) &&
        !f.endsWith(".json"),
    )
    .sort();
  if (docs.length === 0) return null;
  const { tables } = parseFiling(
    docs.map((f) => readFileSync(join(CACHE_DIR, f), "utf-8")),
  );
  const out: Partial<Record<StatementKind, FilingTable>> = {};
  for (const kind of STATEMENT_KINDS) {
    const located = locateStatement(tables, kind);
    if (located) out[kind] = located.table;
  }
  return out;
}
