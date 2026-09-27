import { config } from "dotenv";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

config({ path: ".env.local", quiet: true });

import { analyzeFiling } from "../src/lib/agent/orchestrator";
import { PROMPT_VERSION } from "../src/lib/agent/prompts";
import type { AnalysisResult, ExtractedFigure } from "../src/lib/agent/types";
import { getPool } from "../src/lib/db";
import { FIELDS, type FieldKey } from "../src/lib/fields";
import { loadGoldenSet, type GoldenFiling } from "../src/lib/golden";
import { CHAT_MODEL, isMockMode } from "../src/lib/llm/client";

// Runs the full pipeline on every golden-set filing and grades each
// extracted figure against the SEC's XBRL value for that filing. Only
// figures the answer-key audit found printed on the statement are graded.

type Outcome =
  | "correct"
  | "correct_alternate"
  | "wrong_sign"
  | "wrong_value"
  | "missing";

interface Graded {
  ticker: string;
  sector: string;
  field: FieldKey;
  expected: number;
  actual: number | null;
  outcome: Outcome;
  rowLabel: string | null;
  expectedRows: string[];
  groundingMismatch: boolean;
}

// Each filing runs three model calls at once; two filings at a time stays
// inside the account's tokens-per-minute limit.
const CONCURRENCY = 2;

function grade(
  fig: ExtractedFigure | undefined,
  expected: number,
  alternates: number[],
): Outcome {
  if (!fig || fig.value === null) return "missing";
  // Printed figures are rounded to the statement's unit; EPS to the cent.
  const tol = fig.field === "epsDiluted" ? 0.005 : fig.scale / 2;
  const matches = (v: number) =>
    Math.abs(Math.abs(fig.value!) - Math.abs(v)) <= tol;
  if (!matches(expected)) {
    return alternates.some(matches) ? "correct_alternate" : "wrong_value";
  }
  const signsAgree =
    expected === 0 ||
    fig.value === 0 ||
    Math.sign(fig.value) === Math.sign(expected);
  return signsAgree ? "correct" : "wrong_sign";
}

async function runOne(
  filing: GoldenFiling,
): Promise<{ result: AnalysisResult; graded: Graded[] }> {
  const result = await analyzeFiling(
    filing.ticker,
    {
      cik: filing.cik,
      companyName: filing.companyName,
      accessionNumber: filing.accessionNumber,
      form: "10-K",
      filingDate: filing.filingDate,
      reportDate: filing.periodEnd,
      primaryDocument: filing.url.split("/").pop()!,
      url: filing.url,
    },
    { source: "golden_set" },
  );
  const graded: Graded[] = [];
  for (const spec of FIELDS) {
    const key = filing.answerKey[spec.key];
    if (!key?.onStatement) continue;
    const fig = result.figures.find((f) => f.field === spec.key);
    graded.push({
      ticker: filing.ticker,
      sector: filing.sector,
      field: spec.key,
      expected: key.value,
      actual: fig?.value ?? null,
      outcome: grade(fig, key.value, key.alternates ?? []),
      rowLabel: fig?.rowLabel ?? null,
      expectedRows: key.rowLabels,
      groundingMismatch: fig?.groundingMismatch ?? false,
    });
  }
  return { result, graded };
}

async function saveScores(result: AnalysisResult, graded: Graded[]) {
  const pool = getPool();
  for (const g of graded) {
    await pool.query(
      `insert into eval_scores (run_id, accession_number, field, expected, actual, outcome, details)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        result.runId,
        result.accessionNumber,
        g.field,
        g.expected,
        g.actual,
        g.outcome,
        JSON.stringify({ rowLabel: g.rowLabel, expectedRows: g.expectedRows }),
      ],
    );
  }
}

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`;
}

function table(headers: string[], rows: (string | number)[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => "---").join("|")}|`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");
}

async function main() {
  const { filings } = loadGoldenSet();
  const only = process.argv.slice(2).map((t) => t.toUpperCase());
  const targets = only.length
    ? filings.filter((f) => only.includes(f.ticker))
    : filings;
  const mode = isMockMode() ? "mock" : "live";
  console.log(`Evaluating ${targets.length} filings (mode=${mode})\n`);

  const results: { result: AnalysisResult; graded: Graded[] }[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < targets.length) {
        const filing = targets[next++];
        const out = await runOne(filing);
        await saveScores(out.result, out.graded);
        results.push(out);
        const ok = out.graded.filter((g) => g.outcome.startsWith("correct")).length;
        console.log(
          `${filing.ticker.padEnd(5)} ${ok}/${out.graded.length}` +
            (out.result.retryCount ? `  retried` : "") +
            (out.result.status === "failed"
              ? `  FAILED: ${out.result.error}`
              : ""),
        );
      }
    }),
  );

  const graded = results.flatMap((r) => r.graded);
  const count = (o: Outcome) => graded.filter((g) => g.outcome === o).length;
  const alternate = count("correct_alternate");
  const correct = count("correct") + alternate;
  const magnitudeRight = correct + count("wrong_sign");
  const runs = results.map((r) => r.result);
  const cost = runs.reduce((s, r) => s + r.totalCostUsd, 0);
  const latency = runs.reduce((s, r) => s + r.totalLatencyMs, 0) / runs.length;
  const retried = runs.filter((r) => r.retryCount > 0).length;
  const grounding = graded.filter((g) => g.groundingMismatch).length;
  const checks = runs.flatMap((r) => r.checks).filter((c) => !c.skipped);

  const byField = FIELDS.map((spec) => {
    const g = graded.filter((x) => x.field === spec.key);
    const c = g.filter((x) => x.outcome.startsWith("correct")).length;
    return [spec.label, c, g.length, pct(c, g.length)];
  });
  const sectors = [...new Set(graded.map((g) => g.sector))];
  const bySector = sectors.map((s) => {
    const g = graded.filter((x) => x.sector === s);
    const c = g.filter((x) => x.outcome.startsWith("correct")).length;
    return [s, c, g.length, pct(c, g.length)];
  });
  const checkNames = [...new Set(checks.map((c) => c.name))];
  const byCheck = checkNames.map((n) => {
    const c = checks.filter((x) => x.name === n);
    const p = c.filter((x) => x.passed).length;
    return [n, p, c.length, pct(p, c.length)];
  });
  const misses = graded
    .filter((g) => !g.outcome.startsWith("correct"))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));

  const md = [
    "# Tickertape evaluation",
    "",
    `Run on ${new Date().toISOString()}. Model: \`${CHAT_MODEL}\` (mode: ${mode}). Prompt version: \`${PROMPT_VERSION}\`.`,
    "",
    "Every figure is graded against the SEC's XBRL value for the same filing and period. Only figures printed on the statement the agents read are graded (539 of 542 in the golden set; see the golden set page for the 3 that aren't).",
    "",
    `- **Filings:** ${runs.length} (${runs.filter((r) => r.status === "completed").length} completed)`,
    `- **Figure accuracy:** ${correct}/${graded.length} (${pct(correct, graded.length)}) exact, sign included`,
    `- **Right figure, any sign:** ${magnitudeRight}/${graded.length} (${pct(magnitudeRight, graded.length)})`,
    `- **Matched the SEC's alternate concept** (both tagged and printed, e.g. Walmart's total revenues vs net sales): ${alternate}`,
    `- **Missing (agent said not printed):** ${count("missing")}  |  **wrong row:** ${count("wrong_value")}  |  **wrong sign:** ${count("wrong_sign")}`,
    `- **Grounding mismatches** (agent misreported a printed figure; the cell was used instead): ${grounding}`,
    `- **Retries:** ${retried}/${runs.length} filings needed one`,
    `- **Cost:** $${cost.toFixed(4)} total, $${(cost / runs.length).toFixed(4)} per filing; avg latency ${(latency / 1000).toFixed(1)}s per filing`,
    "",
    "## Accuracy by field",
    "",
    table(["Field", "Correct", "Graded", "Accuracy"], byField),
    "",
    "## Accuracy by sector",
    "",
    table(["Sector", "Correct", "Graded", "Accuracy"], bySector),
    "",
    "## Reconciliation checks (after retries)",
    "",
    table(["Check", "Passed", "Applied", "Pass rate"], byCheck),
    "",
    "## Misses",
    "",
    misses.length === 0
      ? "None."
      : table(
          [
            "Filing",
            "Field",
            "Outcome",
            "Expected",
            "Got",
            "Row picked",
            "Correct row(s)",
          ],
          misses.map((m) => [
            m.ticker,
            m.field,
            m.outcome,
            m.expected,
            m.actual ?? "-",
            m.rowLabel ?? "-",
            m.expectedRows.join(" / "),
          ]),
        ),
    "",
  ].join("\n");

  mkdirSync(join(process.cwd(), "eval"), { recursive: true });
  writeFileSync(join(process.cwd(), "eval", "results.md"), md);
  writeFileSync(
    join(process.cwd(), "eval", "results.json"),
    JSON.stringify(
      {
        runAt: new Date().toISOString(),
        model: CHAT_MODEL,
        mode,
        promptVersion: PROMPT_VERSION,
        graded,
        runs: runs.map((r) => ({
          runId: r.runId,
          accessionNumber: r.accessionNumber,
          status: r.status,
          retryCount: r.retryCount,
          costUsd: r.totalCostUsd,
          latencyMs: r.totalLatencyMs,
          checks: r.checks,
        })),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`\n${md.split("## Accuracy by field")[0]}`);
  await getPool().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
