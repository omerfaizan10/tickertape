import { existsSync, readFileSync } from "fs";
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
