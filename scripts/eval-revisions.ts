import { config } from "dotenv";
import { writeFileSync } from "fs";
import { join } from "path";

config({ path: ".env.local", quiet: true });

import { analyzeFiling } from "../src/lib/agent/orchestrator";
import { PROMPT_VERSION } from "../src/lib/agent/prompts";
import { getPool } from "../src/lib/db";
import { FIELDS, type FieldKey } from "../src/lib/fields";
import { loadGoldenSet, type GoldenFiling } from "../src/lib/golden";
import { CHAT_MODEL, isMockMode } from "../src/lib/llm/client";
import type { Revision } from "../src/lib/revisions";
import type { RevisionExplanation } from "../src/lib/agent/explain-revisions";
import type { FilingRef } from "../src/lib/sec/client";

// Grades restatement detection. For every golden-set filing, the pipeline
// reads this year's 10-K and last year's, and code compares last year's
// figures as reprinted now against as originally reported. Each field is
// then scored against the SEC's XBRL for both filings: was it revised, and
// did the detector say so?

type Outcome =
  "true_positive" | "false_positive" | "false_negative" | "true_negative";

interface GradedRevision {
  ticker: string;
  field: FieldKey;
  outcome: Outcome;
  truth: { original: number; reprinted: number; revised: boolean };
  detected: Revision | null;
  // For true positives: did both sides match the SEC's figures?
  amountsRight: boolean | null;
}

const CONCURRENCY = 2;

const explanations: { ticker: string; explanations: RevisionExplanation[] }[] =
  [];

function ref(
  f: GoldenFiling,
  p: {
    accessionNumber: string;
    periodEnd: string;
    filingDate: string;
    url: string;
  },
): FilingRef {
  return {
    cik: f.cik,
    companyName: f.companyName,
    accessionNumber: p.accessionNumber,
    form: "10-K",
    filingDate: p.filingDate,
    reportDate: p.periodEnd,
    primaryDocument: p.url.split("/").pop()!,
    url: p.url,
  };
}

function near(a: number, b: number, tol: number) {
  return Math.abs(a - b) <= tol;
}

async function gradeOne(f: GoldenFiling): Promise<GradedRevision[]> {
  if (!f.priorFiling) return [];
  // The product path: this filing's run, with last year's 10-K read and
  // compared inside it (row alignment, check flags and the explainer
  // included).
  const current = await analyzeFiling(f.ticker, ref(f, f), {
    source: "golden_set",
    priorYear: ref(f, f.priorFiling),
  });
  const detected = current.priorYear?.revisions ?? [];
  explanations.push({
    ticker: f.ticker,
    explanations: current.priorYear?.explanations ?? [],
  });
  const graded: GradedRevision[] = [];
  for (const spec of FIELDS) {
    const truth = f.revisions[spec.key];
    // Only score fields the answer key grades on this statement.
    if (!truth || !f.answerKey[spec.key]?.onStatement) continue;
    const d = detected.find((x) => x.field === spec.key) ?? null;
    const flagged = d?.revised ?? false;
    const outcome: Outcome = truth.revised
      ? flagged
        ? "true_positive"
        : "false_negative"
      : flagged
        ? "false_positive"
        : "true_negative";
    const tol = spec.unit === "USD/shares" ? 0.005 : 1e6;
    graded.push({
      ticker: f.ticker,
      field: spec.key,
      outcome,
      truth,
      detected: d,
      amountsRight:
        outcome === "true_positive" && d
          ? near(d.original, truth.original, tol) &&
            near(d.reprinted, truth.reprinted, tol)
          : null,
    });
  }
  return graded;
}

async function main() {
  const { filings } = loadGoldenSet();
  const only = process.argv.slice(2).map((t) => t.toUpperCase());
  const targets = only.length
    ? filings.filter((f) => only.includes(f.ticker))
    : filings;
  console.log(
    `Restatement eval on ${targets.length} filing pairs (mode=${isMockMode() ? "mock" : "live"})\n`,
  );

  const all: GradedRevision[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < targets.length) {
        const f = targets[next++];
        const g = await gradeOne(f);
        all.push(...g);
        const flags = g.filter(
          (x) =>
            x.outcome === "true_positive" || x.outcome === "false_positive",
        );
        const misses = g.filter((x) => x.outcome === "false_negative");
        console.log(
          `${f.ticker.padEnd(5)} compared ${g.length}` +
            (flags.length
              ? `  flagged: ${flags.map((x) => `${x.field}${x.outcome === "false_positive" ? " (FALSE)" : ""}`).join(", ")}`
              : "") +
            (misses.length
              ? `  MISSED: ${misses.map((x) => x.field).join(", ")}`
              : ""),
        );
      }
    }),
  );

  const n = (o: Outcome) => all.filter((x) => x.outcome === o).length;
  const tp = n("true_positive");
  const fp = n("false_positive");
  const fn = n("false_negative");
  const tn = n("true_negative");
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  const amounts = all.filter((x) => x.amountsRight !== null);
  const pctStr = (v: number | null) =>
    v === null ? "n/a" : `${(v * 100).toFixed(1)}%`;

  const rows = all
    .filter((x) => x.outcome !== "true_negative")
    .sort((a, b) => a.ticker.localeCompare(b.ticker))
    .map(
      (x) =>
        `| ${x.ticker} | ${x.field} | ${x.outcome.replace("_", " ")} | ${x.truth.original} | ${x.truth.reprinted} | ${x.detected ? `${x.detected.original} -> ${x.detected.reprinted}` : "-"} |`,
    );

  const md = [
    "# Restatement detection evaluation",
    "",
    `Run on ${new Date().toISOString()}. Model: \`${CHAT_MODEL}\`. Prompt version: \`${PROMPT_VERSION}\`.`,
    "",
    "For each golden-set filing the pipeline reads this year's 10-K and last year's. Code compares last year's figures as this year's 10-K reprints them against as last year's 10-K originally reported them, and flags anything more than rounding apart. Ground truth is the SEC's XBRL for both filings.",
    "",
    `- **Prior-year figures compared:** ${all.length} across ${targets.length} filing pairs`,
    `- **Actually revised (per XBRL):** ${tp + fn}`,
    `- **Precision:** ${pctStr(precision)} (${tp} of ${tp + fp} flags were real)`,
    `- **Recall:** ${pctStr(recall)} (${tp} of ${tp + fn} revisions caught)`,
    `- **False alarms:** ${fp} of ${fp + tn} unrevised figures`,
    `- **Both amounts right on caught revisions:** ${amounts.filter((x) => x.amountsRight).length}/${amounts.length}`,
    "",
    "## Explanations (from the filings' own text, quotes checked word for word)",
    "",
    ...explanations
      .filter((e) => e.explanations.length > 0)
      .sort((a, b) => a.ticker.localeCompare(b.ticker))
      .flatMap((e) =>
        e.explanations.map(
          (x) =>
            `- **${e.ticker}** (${x.fields.join(", ")}): ${x.cause.replace(/_/g, " ")}. ${x.summary}${x.verified ? ` Quote: "${x.quote}"` : " (no verified quote)"}`,
        ),
      ),
    "",
    "## Every flag and every miss",
    "",
    rows.length
      ? [
          "| Filing | Field | Outcome | Originally (SEC) | Reprinted (SEC) | Detected |",
          "|---|---|---|---|---|---|",
          ...rows,
        ].join("\n")
      : "None.",
    "",
  ].join("\n");

  writeFileSync(join(process.cwd(), "eval", "revisions.md"), md);
  writeFileSync(
    join(process.cwd(), "eval", "revisions.json"),
    JSON.stringify(
      {
        runAt: new Date().toISOString(),
        model: CHAT_MODEL,
        promptVersion: PROMPT_VERSION,
        graded: all,
        explanations,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("\n" + md.split("## Every flag")[0]);
  await getPool().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
