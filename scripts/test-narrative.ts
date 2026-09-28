import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { loadGoldenSet } from "../src/lib/golden";
import { parseFiling } from "../src/lib/sec/filing-text";
import { locateStatement } from "../src/lib/sec/locate-statements";
import { detectScale, parseAmount } from "../src/lib/sec/units";
import { verifyClaims, type ClaimInput } from "../src/lib/agent/narrative";
import type { ExtractedFigure } from "../src/lib/agent/types";
import type { FieldKey } from "../src/lib/fields";

// Can the claim checker catch a false claim, or does it just wave
// everything through? For every golden-set filing this writes claims from
// the filing's own figures - true ones, and false ones that are clearly
// wrong - in the way MD&A phrases them, and runs them through the same
// verification code the pipeline uses. No model involved.
//
// A true claim must come back consistent; a false one inconsistent.
// "Not checked" counts against the checker either way: a checker that
// declines to judge isn't catching anything.

const PHRASE: Partial<Record<FieldKey, string>> = {
  revenue: "Total revenues",
  operatingIncome: "Operating income",
  netIncome: "Net income",
  epsDiluted: "Diluted earnings per share",
  operatingCashFlow: "Net cash provided by operating activities",
};

function money(v: number, isEps: boolean): string {
  if (isEps) return `$${Math.abs(v).toFixed(2)}`;
  return `$${Math.round(Math.abs(v) / 1e6).toLocaleString("en-US")} million`;
}

interface Case {
  ticker: string;
  field: FieldKey;
  truth: boolean;
  kind: ClaimInput["kind"];
  sentence: string;
  claim: ClaimInput;
}

// The figures printed in a filing's tables other than its three
// statements - what the pipeline passes to the checker so a claim quoting
// a segment's figure isn't flagged. Used here so the test also measures
// how often a false claim could hide behind a coincidental match.
const CACHE = join(process.cwd(), "data", "cache");
function elsewhere(ticker: string, accn: string): Set<number> {
  const out = new Set<number>();
  if (!existsSync(CACHE)) return out;
  const docs = readdirSync(CACHE)
    .filter((f) => f.startsWith(`${ticker}-${accn}`) && !f.endsWith(".json"))
    .sort()
    .map((f) => readFileSync(join(CACHE, f), "utf-8"));
  const { tables } = parseFiling(docs);
  const statements = new Set(
    (["income", "balance", "cashflow"] as const)
      .map((k) => locateStatement(tables, k)?.table.index)
      .filter((i) => i !== undefined),
  );
  for (const t of tables) {
    if (statements.has(t.index)) continue;
    const scale = detectScale(t);
    for (const row of t.rows) {
      for (const cell of row.slice(1)) {
        const n = parseAmount(cell);
        if (n !== null && Math.abs(n) >= 1) out.add(n * scale);
      }
    }
  }
  return out;
}

const cases: Case[] = [];
const elsewhereFor = new Map<string, Set<number>>();
const figuresFor = new Map<string, ExtractedFigure[]>();
const periodFor = new Map<string, string>();

for (const f of loadGoldenSet().filings) {
  const year = f.periodEnd.slice(0, 4);
  const prior = String(Number(year) - 1);
  const figures: ExtractedFigure[] = [];
  for (const [key, phrase] of Object.entries(PHRASE) as [FieldKey, string][]) {
    const now = f.answerKey[key];
    const reprint = f.revisions[key];
    if (!now?.onStatement || !reprint) continue;
    const isEps = key === "epsDiluted";
    const statement = key === "operatingCashFlow" ? "cashflow" : "income";
    figures.push({
      field: key,
      value: now.value,
      rowIndex: null,
      rowLabel: now.rowLabels[0] ?? phrase,
      printed: null,
      scale: isEps ? 1 : (f.statements[statement]?.scale ?? 1e6),
      agentPrinted: null,
      groundingMismatch: false,
      note: "",
      priorValue: reprint.reprinted,
      priorPrinted: null,
      failedChecks: [],
    });
    const then = reprint.reprinted;
    if (then === 0) continue;
    const delta = now.value - then;
    const up = delta > 0;
    const verb = up ? "increased" : "decreased";
    const wrongVerb = up ? "decreased" : "increased";
    const pct = Math.abs((delta / Math.abs(then)) * 100);
    const add = (
      truth: boolean,
      kind: ClaimInput["kind"],
      asWritten: string,
      sentence: string,
      direction: ClaimInput["direction"],
    ) =>
      cases.push({
        ticker: f.ticker,
        field: key,
        truth,
        kind,
        sentence,
        claim: {
          field: key,
          kind,
          asWritten,
          direction,
          scope: "consolidated",
          quote: sentence,
        },
      });

    const truePct = `${pct.toFixed(1)}%`;
    const falsePct = `${(pct + 3).toFixed(1)}%`;
    add(
      true,
      "percent_change",
      truePct,
      `${phrase} ${verb} ${truePct} in ${year} compared with ${prior}.`,
      up ? "up" : "down",
    );
    add(
      false,
      "percent_change",
      falsePct,
      `${phrase} ${verb} ${falsePct} in ${year} compared with ${prior}.`,
      up ? "up" : "down",
    );

    const trueAmt = money(delta, isEps);
    const falseAmt = money(Math.abs(delta) * 1.1 + (isEps ? 0.05 : 5e7), isEps);
    add(
      true,
      "amount_change",
      trueAmt,
      `${phrase} ${verb} ${trueAmt} in ${year} compared with ${prior}.`,
      up ? "up" : "down",
    );
    add(
      false,
      "amount_change",
      falseAmt,
      `${phrase} ${verb} ${falseAmt} in ${year} compared with ${prior}.`,
      up ? "up" : "down",
    );

    const trueLevel = money(now.value, isEps);
    // Wrong by an amount that survives rounding: 7% for dollar figures,
    // ten cents for EPS (7% of Intel's -$0.06 still prints as $0.06).
    const falseLevel = money(
      isEps ? Math.abs(now.value) + 0.1 : now.value * 1.07,
      isEps,
    );
    add(true, "current_value", trueLevel, `${phrase} was ${trueLevel} in ${year}.`, "none");
    add(false, "current_value", falseLevel, `${phrase} was ${falseLevel} in ${year}.`, "none");

    add(
      true,
      "direction",
      verb,
      `${phrase} ${verb} in ${year} compared with ${prior}.`,
      up ? "up" : "down",
    );
    add(
      false,
      "direction",
      wrongVerb,
      `${phrase} ${wrongVerb} in ${year} compared with ${prior}.`,
      up ? "down" : "up",
    );
  }
  figuresFor.set(f.ticker, figures);
  elsewhereFor.set(f.ticker, elsewhere(f.ticker, f.accessionNumber));
  periodFor.set(f.ticker, f.periodEnd);
}

let caught = 0,
  missedFalse = 0,
  skippedFalse = 0;
let confirmed = 0,
  falseAlarms = 0,
  skippedTrue = 0;
const problems: string[] = [];
for (const c of cases) {
  // Each claim is checked alone, so the rule about conflicting claims in
  // one filing doesn't let the false claims hide behind the true ones.
  const [out] = verifyClaims(
    [c.claim],
    [c.sentence],
    figuresFor.get(c.ticker)!,
    {},
    periodFor.get(c.ticker)!,
    elsewhereFor.get(c.ticker),
  );
  if (c.truth) {
    if (out.verdict === "consistent") confirmed++;
    else if (out.verdict === "inconsistent") {
      falseAlarms++;
      problems.push(`FALSE ALARM ${c.ticker} ${c.sentence} | ${out.reason}`);
    } else {
      skippedTrue++;
      problems.push(`SKIPPED TRUE ${c.ticker} ${c.sentence} | ${out.reason}`);
    }
  } else {
    if (out.verdict === "inconsistent") caught++;
    else if (out.verdict === "consistent") {
      missedFalse++;
      problems.push(`MISSED ${c.ticker} ${c.sentence} | ${out.reason}`);
    } else {
      skippedFalse++;
      problems.push(`SKIPPED FALSE ${c.ticker} ${c.sentence} | ${out.reason}`);
    }
  }
}
const nTrue = cases.filter((c) => c.truth).length;
const nFalse = cases.length - nTrue;
console.log(`${cases.length} synthetic claims from ${figuresFor.size} filings`);
console.log(
  `false claims caught:  ${caught}/${nFalse}  (missed ${missedFalse}, declined to judge ${skippedFalse})`,
);
console.log(
  `true claims confirmed: ${confirmed}/${nTrue}  (false alarms ${falseAlarms}, declined to judge ${skippedTrue})`,
);
problems.slice(0, 15).forEach((p) => console.log("  ", p));
if (missedFalse > 0 || falseAlarms > 0) process.exit(1);
