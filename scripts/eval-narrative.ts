import { config } from "dotenv";
import { writeFileSync } from "fs";
import { join } from "path";

config({ path: ".env.local", quiet: true });

import { analyzeFiling } from "../src/lib/agent/orchestrator";
import type { NarrativeClaim } from "../src/lib/agent/narrative";
import { PROMPT_VERSION } from "../src/lib/agent/prompts";
import { getPool } from "../src/lib/db";
import { loadGoldenSet } from "../src/lib/golden";
import { CHAT_MODEL } from "../src/lib/llm/client";

// Runs the narrative check on every golden-set filing. There is no answer
// key for "does MD&A match the numbers", so this reports what can be
// counted honestly (claims found, quotes verified, how many were checkable,
// how many held up) and lists every inconsistency in full for a person to
// review, rather than claiming an accuracy number it can't back.

const CONCURRENCY = 2;

async function main() {
  const { filings } = loadGoldenSet();
  const only = process.argv.slice(2).map((t) => t.toUpperCase());
  const targets = only.length
    ? filings.filter((f) => only.includes(f.ticker))
    : filings;

  const all: { ticker: string; claim: NarrativeClaim }[] = [];
  let next = 0;
  let cost = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < targets.length) {
        const f = targets[next++];
        const result = await analyzeFiling(
          f.ticker,
          {
            cik: f.cik,
            companyName: f.companyName,
            accessionNumber: f.accessionNumber,
            form: "10-K",
            filingDate: f.filingDate,
            reportDate: f.periodEnd,
            primaryDocument: f.url.split("/").pop()!,
            url: f.url,
          },
          { source: "golden_set", narrative: true },
        );
        cost += result.totalCostUsd;
        const claims = result.narrative ?? [];
        all.push(...claims.map((claim) => ({ ticker: f.ticker, claim })));
        const bad = claims.filter((c) => c.verdict === "inconsistent");
        console.log(
          `${f.ticker.padEnd(5)} claims ${claims.length}, checked ${claims.filter((c) => c.verdict !== "not_checked").length}` +
            (bad.length
              ? `  INCONSISTENT: ${bad.map((c) => c.field).join(", ")}`
              : ""),
        );
      }
    }),
  );

  const n = (pred: (c: NarrativeClaim) => boolean) =>
    all.filter((x) => pred(x.claim)).length;
  const verified = n((c) => c.quoteVerified);
  const consolidated = n((c) => c.quoteVerified && c.scope === "consolidated");
  const checked = n((c) => c.verdict !== "not_checked");
  const consistent = n((c) => c.verdict === "consistent");
  const inconsistent = all.filter((x) => x.claim.verdict === "inconsistent");

  const md = [
    "# Narrative consistency check",
    "",
    `Run on ${new Date().toISOString()}. Model: \`${CHAT_MODEL}\`. Prompt version: \`${PROMPT_VERSION}\`.`,
    "",
    "An agent lists the year-over-year claims management makes in MD&A; code verifies each quote word for word, reads the number as written, and checks it against the figures the pipeline read from the statements, to the precision the claim itself states. Only claims about the consolidated GAAP figure are checked: segment, regional, constant-currency and non-GAAP claims can't be confirmed from the statements. There is no answer key for this, so every inconsistency is listed below for review.",
    "",
    `- **Filings:** ${targets.length}`,
    `- **Claims extracted:** ${all.length}`,
    `- **Quotes found word for word in the filing:** ${verified}/${all.length}`,
    `- **About the consolidated GAAP figure:** ${consolidated}`,
    `- **Checked against the statements:** ${checked}`,
    `- **Consistent:** ${consistent}/${checked}`,
    `- **Inconsistent (listed below):** ${inconsistent.length}`,
    `- **Cost:** $${cost.toFixed(4)} total, including extraction`,
    "",
    "## Every inconsistency",
    "",
    inconsistent.length === 0
      ? "None."
      : inconsistent
          .map(
            ({ ticker, claim: c }) =>
              `- **${ticker}** ${c.field} (${c.kind}, claims ${c.asWritten}): ${c.reason}.\n  > ${c.quote}`,
          )
          .join("\n"),
    "",
  ].join("\n");

  writeFileSync(join(process.cwd(), "eval", "narrative.md"), md);
  writeFileSync(
    join(process.cwd(), "eval", "narrative.json"),
    JSON.stringify(
      {
        runAt: new Date().toISOString(),
        model: CHAT_MODEL,
        promptVersion: PROMPT_VERSION,
        claims: all,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("\n" + md);
  await getPool().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
