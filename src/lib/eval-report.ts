import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import type { ReconciliationCheck } from "./agent/types";
import type { FieldKey } from "./fields";

// The latest eval, as written by scripts/eval.ts. Read from the committed
// report file rather than the database so the dashboard shows exactly the
// numbers in eval/results.md.

export interface GradedFigure {
  ticker: string;
  sector: string;
  field: FieldKey;
  expected: number;
  actual: number | null;
  outcome:
    | "correct"
    | "correct_alternate"
    | "wrong_sign"
    | "wrong_value"
    | "missing";
  rowLabel: string | null;
  expectedRows: string[];
  groundingMismatch: boolean;
}

export interface EvalReport {
  runAt: string;
  model: string;
  mode: "live" | "mock";
  promptVersion: string;
  graded: GradedFigure[];
  runs: {
    runId: string;
    accessionNumber: string;
    status: string;
    retryCount: number;
    costUsd: number;
    latencyMs: number;
    checks: ReconciliationCheck[];
  }[];
}

export function loadEvalReport(): EvalReport | null {
  const path = join(process.cwd(), "eval", "results.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function isCorrect(g: GradedFigure): boolean {
  return g.outcome === "correct" || g.outcome === "correct_alternate";
}

export interface RevisionEvalReport {
  runAt: string;
  model: string;
  promptVersion: string;
  graded: {
    ticker: string;
    field: FieldKey;
    outcome:
      | "true_positive"
      | "false_positive"
      | "false_negative"
      | "true_negative";
    truth: { original: number; reprinted: number; revised: boolean };
    detected: { original: number; reprinted: number } | null;
    amountsRight: boolean | null;
  }[];
  explanations: {
    ticker: string;
    explanations: {
      fields: string[];
      cause: string;
      summary: string;
      quote: string | null;
      verified: boolean;
    }[];
  }[];
}

export function loadRevisionEval(): RevisionEvalReport | null {
  const path = join(process.cwd(), "eval", "revisions.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

export interface ModelRow {
  model: string;
  graded: number;
  correct: number;
  costPerFiling: number;
  secondsPerFiling: number;
  retried: number;
  filings: number;
}

// Full-golden-set runs only: the headline report plus eval/models/*.json.
export function loadModelComparison(): ModelRow[] {
  const files = [join(process.cwd(), "eval", "results.json")];
  const dir = join(process.cwd(), "eval", "models");
  if (existsSync(dir)) {
    files.push(
      ...readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => join(dir, f)),
    );
  }
  const rows: ModelRow[] = [];
  for (const f of files) {
    if (!existsSync(f)) continue;
    const r: EvalReport = JSON.parse(readFileSync(f, "utf-8"));
    if (r.mode !== "live") continue;
    rows.push({
      model: r.model,
      graded: r.graded.length,
      correct: r.graded.filter(isCorrect).length,
      costPerFiling: r.runs.reduce((s, x) => s + x.costUsd, 0) / r.runs.length,
      secondsPerFiling:
        r.runs.reduce((s, x) => s + x.latencyMs, 0) / r.runs.length / 1000,
      retried: r.runs.filter((x) => x.retryCount > 0).length,
      filings: r.runs.length,
    });
  }
  const golden = Math.max(...rows.map((r) => r.filings), 0);
  return rows
    .filter((r) => r.filings === golden)
    .sort((a, b) => a.costPerFiling - b.costPerFiling);
}

export interface NarrativeReport {
  claims: {
    ticker: string;
    claim: {
      quoteVerified: boolean;
      scope: string;
      verdict: "consistent" | "inconsistent" | "not_checked";
    };
  }[];
}

export function loadNarrativeReport(): NarrativeReport | null {
  const path = join(process.cwd(), "eval", "narrative.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}
