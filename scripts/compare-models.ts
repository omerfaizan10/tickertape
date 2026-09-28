import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { loadGoldenSet } from "../src/lib/golden";

// Puts every full-golden-set eval side by side: accuracy, cost, latency,
// retries - and accuracy split by whether a filing was made before or
// after the model's training cutoff. A model could have seen a filing made
// before its cutoff; it cannot have seen one made after. If reading were
// really recall, the split would show it.

// From each model's page on developers.openai.com, checked 2026-09-28.
const KNOWLEDGE_CUTOFF: Record<string, string> = {
  "gpt-4o-mini": "2023-10-01",
  "gpt-6-luna": "2026-05-18",
  "gpt-6-sol": "2026-04-20",
};

interface Report {
  model: string;
  mode: string;
  promptVersion: string;
  graded: { ticker: string; outcome: string }[];
  runs: { costUsd: number; latencyMs: number; retryCount: number }[];
}

const correct = (o: string) => o === "correct" || o === "correct_alternate";

function load(path: string): Report | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

function main() {
  const golden = loadGoldenSet();
  const filed = new Map(golden.filings.map((f) => [f.ticker, f.filingDate]));
  const reports: Report[] = [];
  const headline = load(join(process.cwd(), "eval", "results.json"));
  if (headline) reports.push(headline);
  const dir = join(process.cwd(), "eval", "models");
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const r = load(join(dir, f));
      // Only full runs over the whole golden set are comparable.
      if (r && r.runs.length === golden.filings.length && r.mode === "live") {
        reports.push(r);
      }
    }
  }

  const pct = (n: number, d: number) =>
    d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`;
  const rows = reports.map((r) => {
    const base = r.model.split("@")[0];
    const cutoff = KNOWLEDGE_CUTOFF[base];
    const ok = r.graded.filter((g) => correct(g.outcome)).length;
    const before = cutoff
      ? r.graded.filter((g) => (filed.get(g.ticker) ?? "") < cutoff)
      : [];
    const after = cutoff
      ? r.graded.filter((g) => (filed.get(g.ticker) ?? "") >= cutoff)
      : [];
    const cost = r.runs.reduce((s, x) => s + x.costUsd, 0) / r.runs.length;
    const latency = r.runs.reduce((s, x) => s + x.latencyMs, 0) / r.runs.length;
    const retried = r.runs.filter((x) => x.retryCount > 0).length;
    return `| \`${r.model}\` | ${ok}/${r.graded.length} (${pct(ok, r.graded.length)}) | ${
      before.length
        ? `${pct(before.filter((g) => correct(g.outcome)).length, before.length)} of ${before.length}`
        : "none"
    } | ${
      after.length
        ? `${pct(after.filter((g) => correct(g.outcome)).length, after.length)} of ${after.length}`
        : "none"
    } | $${cost.toFixed(4)} | ${(latency / 1000).toFixed(1)}s | ${retried}/${r.runs.length} | ${cutoff ?? "unknown"} |`;
  });

  const md = [
    "# Model comparison",
    "",
    `Every model runs the same pipeline, prompts (\`${reports[0]?.promptVersion ?? "?"}\`) and checks on all ${golden.filings.length} golden-set filings. Only the model that picks rows changes. Costs use OpenAI's standard-tier prices, checked 2026-09-28; reasoning tokens are billed as output.`,
    "",
    "Before/after cutoff splits each model's graded figures by whether the filing was made before or after that model's training cutoff. A model could have seen a filing made before its cutoff during training; it cannot have seen one made after.",
    "",
    "| Model | Figure accuracy | Filed before cutoff | Filed after cutoff | Cost / filing | Time / filing | Retried | Cutoff |",
    "|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
  writeFileSync(join(process.cwd(), "eval", "models.md"), md);
  console.log(md);
}

main();
