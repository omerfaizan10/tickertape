import { z } from "zod";
import { runAgentStep } from "../llm/client";
import { FIELDS, type FieldKey } from "../fields";
import type { FilingTable } from "../sec/filing-text";
import type { StatementKind } from "../sec/locate-statements";
import { detectScale, parseAmount } from "../sec/units";
import { figureAt, headerAbove } from "./statement-view";
import type { AgentStepResult, ExtractedFigure } from "./types";

// Does management's discussion match the numbers? MD&A is full of claims
// like "Net sales increased 6% to $391.0 billion". The agent's job is only
// to find those claims and say what each one is about; whether a claim is
// true is arithmetic on figures the pipeline already read from the
// statements, so code decides that.
//
// Everything that decides a verdict is code, and each guard came from a
// false alarm in a trial run:
// - the quote must be in the filing word for word, contain the claimed
//   number, and name the figure (Coca-Cola's "equity income increased $261
//   million" is not a net income claim);
// - only claims about the consolidated GAAP figure are checked, and scope
//   belongs to the whole sentence (JPMorgan's "Net revenue was $24.1
//   billion, up 12%" is one business's revenue and its growth);
// - a claim is checked against the statement line it describes, not forced
//   onto one (Walmart's MD&A quotes consolidated net income and net sales,
//   both printed next to the figures the pipeline extracts);
// - a claim is held to the precision it's written in ("6%" to the nearest
//   percent).

const CHECKABLE: FieldKey[] = [
  "revenue",
  "operatingIncome",
  "netIncome",
  "epsDiluted",
  "operatingCashFlow",
  "investingCashFlow",
  "financingCashFlow",
  "cash",
  "totalAssets",
];

export type ClaimVerdict = "consistent" | "inconsistent" | "not_checked";

export interface NarrativeClaim {
  field: FieldKey;
  kind: "percent_change" | "amount_change" | "current_value" | "direction";
  asWritten: string;
  quote: string;
  quoteVerified: boolean;
  scope: "consolidated" | "segment_or_non_gaap";
  claimed: number | null;
  actual: number | null;
  tolerance: number | null;
  verdict: ClaimVerdict;
  reason: string;
}

export type NarrativeTables = Partial<
  Record<
    StatementKind,
    { table: FilingTable; current: number; prior: number | null }
  >
>;

// Statement lines a claim about each field may be describing. Also used to
// require that the quote actually names the figure.
const LINE_VARIANTS: Record<FieldKey, RegExp> = {
  revenue: /revenue|net sales|^sales|total sales/i,
  operatingIncome:
    /operating (income|profit|earnings)|income from operations|earnings from operations/i,
  netIncome:
    /^(consolidated )?net (income|earnings)(?!.*per share)|net (income|earnings) attributable to (?!non)/i,
  epsDiluted: /dilut/i,
  operatingCashFlow: /operating activities/i,
  investingCashFlow: /investing activities/i,
  financingCashFlow: /financing activities/i,
  cash: /^cash and cash equivalents/i,
  totalAssets: /^total assets/i,
  totalLiabilities: /^total liabilities/i,
  totalEquity: /equity/i,
};

// How a quote names each figure, in running prose rather than as a
// statement label.
const NAMED_IN_TEXT: Partial<Record<FieldKey, RegExp>> = {
  revenue: /revenue|net sales|\bsales\b/i,
  operatingIncome:
    /operating (income|profit|earnings)|income from operations|earnings from operations/i,
  netIncome: /net (income|earnings)/i,
  epsDiluted: /per (diluted )?share|\beps\b/i,
  operatingCashFlow:
    /operating activities|cash (provided|generated|from) (by )?operat|operating cash flow/i,
  investingCashFlow: /investing activities/i,
  financingCashFlow: /financing activities/i,
  cash: /cash and cash equivalents/i,
  totalAssets: /total assets/i,
};

const MAX_PASSAGES = 12;
const MAX_PASSAGE_CHARS = 1200;

const METRIC_WORDS =
  /revenue|net sales|net income|net earnings|operating income|operating profit|earnings per share|diluted eps|cash (provided|generated|flows?) (by|from) operat|cash and cash equivalents|total assets/i;
const CHANGE_WORDS =
  /increas|decreas|grew|growth|declin|rose|fell|up \d|down \d|compared (to|with)/i;
const HAS_FIGURE = /\d+(\.\d+)?\s*(%|percent|billion|million)|\$\s?\d/i;
const BOILERPLATE = /forward-looking statements|indicate by check mark/i;

// A short line that doesn't end a sentence is a heading ("Construction &
// Forestry Operating Profit"). A passage's heading is usually what says
// it's about a segment; the sentences under it often don't repeat it.
function isHeading(p: string): boolean {
  return p.length < 100 && !/[.!?:;]$/.test(p.trim());
}

function headingFor(paragraphs: string[], i: number): string | null {
  for (let k = i - 1; k >= Math.max(0, i - 12); k--) {
    if (isHeading(paragraphs[k])) return paragraphs[k];
  }
  return null;
}

// Code, not a model, picks the passages: paragraphs that name one of the
// checkable figures, describe a change, and carry a number. Each goes to
// the agent under its section heading.
export function findClaimPassages(paragraphs: string[]): string[] {
  return paragraphs
    .map((p, i) => ({ p, i }))
    .filter(
      ({ p }) =>
        !BOILERPLATE.test(p) &&
        METRIC_WORDS.test(p) &&
        CHANGE_WORDS.test(p) &&
        HAS_FIGURE.test(p),
    )
    .filter((x, k, all) => all.findIndex((y) => y.p === x.p) === k)
    .map(({ p, i }) => ({
      p,
      heading: headingFor(paragraphs, i),
      // Consolidated discussions name the total; favor them.
      score:
        (/(total|consolidated|net sales|net revenue)/i.test(p) ? 2 : 0) +
        (p.match(/%/g)?.length ?? 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PASSAGES)
    .map(
      (x) =>
        `${x.heading ? `[Section: ${x.heading}] ` : ""}${x.p.slice(0, MAX_PASSAGE_CHARS)}`,
    );
}

const schema = z.object({
  claims: z.array(
    z.object({
      field: z.enum(CHECKABLE as [FieldKey, ...FieldKey[]]),
      kind: z.enum([
        "percent_change",
        "amount_change",
        "current_value",
        "direction",
      ]),
      asWritten: z.string(),
      direction: z.enum(["up", "down", "none"]),
      scope: z.enum(["consolidated", "segment_or_non_gaap"]),
      quote: z.string(),
    }),
  ),
});

type RawClaim = z.infer<typeof schema>["claims"][number];

const PROMPT = `You read passages from the Management's Discussion and Analysis in a company's annual report (10-K) and list the specific, checkable claims it makes about the company's own consolidated financial results for the current year versus the prior year.

For each claim return:
- field: which figure it is about (revenue, operatingIncome, netIncome, epsDiluted, operatingCashFlow, investingCashFlow, financingCashFlow, cash, totalAssets)
- kind: percent_change ("increased 6%"), amount_change ("increased $2.1 billion"), current_value ("net sales were $391.0 billion"), or direction ("net income decreased")
- asWritten: the number exactly as written in the text, with its unit, e.g. "6%", "$2.1 billion", "$6.08". For direction claims, the verb.
- direction: up, down, or none
- scope: consolidated if the claim is about the whole company's reported (GAAP) figure; segment_or_non_gaap if it is about a segment, a region, a product line, constant currency, organic growth, an "adjusted" or non-GAAP measure, or a quarter
- quote: the sentence containing the claim, copied exactly, character for character

Rules:
- Only claims about the current fiscal year compared with the prior fiscal year.
- The field must be the figure the sentence names. Equity income, capital expenditures, free cash flow, gross margin and similar lines are not any of these fields: skip them.
- A passage that discusses one segment, business line or region is about that segment even when a sentence doesn't repeat its name: use segment_or_non_gaap for its claims. Each passage starts with its section heading in brackets; a heading naming a segment, division or business ("Construction & Forestry", "Corporate", "AMESA") makes the passage segment-level.
- When unsure whether a claim is about the consolidated GAAP figure, use segment_or_non_gaap.
- Copy quotes exactly; they are checked against the filing.
- Return at most 15 claims, most important first.`;

function normalize(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// "$2.1 billion" -> { value: 2.1e9, tolerance: 0.05e9 }; "6%" -> { 6, 0.5 }.
// The tolerance is half of the last digit the claim itself states, so a
// rounded claim is held exactly to the rounding it chose.
export function parseWritten(s: string): {
  value: number;
  tolerance: number;
  percent: boolean;
  // A dollar amount with no scale word ("$20,287"): many 10-Ks write MD&A
  // amounts in the statements' unit (Costco, AT&T), so it may mean millions.
  bare: boolean;
} | null {
  const text = s.replace(/,/g, "");
  for (const m of text.matchAll(
    /(\$\s?)?(-?\d+(?:\.(\d+))?)\s*(%|percent|billion|million|thousand|bn)?/gi,
  )) {
    const dollar = !!m[1];
    const unit = (m[4] ?? "").toLowerCase();
    // A number with neither a dollar sign nor a unit is a year, a count or
    // a note reference, not the claim ("in 2025 compared to 2024").
    if (!dollar && !unit) continue;
    const n = Number(m[2]);
    const decimals = m[3]?.length ?? 0;
    const scale =
      unit === "billion" || unit === "bn"
        ? 1e9
        : unit === "million"
          ? 1e6
          : unit === "thousand"
            ? 1e3
            : 1;
    return {
      value: n * scale,
      tolerance: (0.5 * scale) / 10 ** decimals,
      percent: unit === "%" || unit === "percent",
      bare: dollar && !unit,
    };
  }
  return null;
}

interface Line {
  label: string;
  // The label with its section header, e.g. "Assuming dilution: Continuing
  // operations", for matching claims that name a narrower line.
  context: string;
  now: number;
  then: number | null;
}

function linesFor(fig: ExtractedFigure, tables: NarrativeTables): Line[] {
  const spec = FIELDS.find((f) => f.key === fig.field)!;
  const t = tables[spec.statement];
  const ownContext =
    t && fig.rowIndex !== null
      ? `${headerAbove(t.table, fig.rowIndex, t.current)} ${fig.rowLabel ?? ""}`
      : (fig.rowLabel ?? "");
  const lines: Line[] = [
    {
      label: fig.rowLabel ?? fig.field,
      context: ownContext,
      now: fig.value!,
      then: fig.priorValue,
    },
  ];
  if (!t) return lines;
  const scale = spec.unit === "USD/shares" ? 1 : detectScale(t.table);
  t.table.rows.forEach((row, i) => {
    const header = headerAbove(t.table, i, t.current);
    // EPS rows are often labeled only "Continuing operations" or "Total"
    // under an "Assuming dilution" header (IBM).
    const variant =
      LINE_VARIANTS[fig.field].test(row[0]) ||
      (fig.field === "epsDiluted" && /dilut/i.test(header));
    if (i === fig.rowIndex || !variant) return;
    const now = parseAmount(figureAt(row, t.current) ?? "");
    if (now === null) return;
    const then =
      t.prior === null ? null : parseAmount(figureAt(row, t.prior) ?? "");
    lines.push({
      label: row[0],
      context: `${header} ${row[0]}`,
      now: now * scale,
      then: then === null ? null : then * scale,
    });
  });
  return lines;
}

const PARTIAL_OR_ADJUSTED =
  /outside (of )?(the )?(united states|u\.s\.)|\binternational\b|\bdomestic\b|\bsegments?\b|\bregions?\b|north america|europe|asia|latin america|\bemea\b|\bapac\b|constant currency|currency-neutral|\borganic\b|\badjusted\b|non-gaap|excluding|\bquarter\b|non-?controlling|minority interest|restricted cash|marketable securities|per (piece|unit|day|customer|package)|\b(product|products|service|services|subscription|footwear|apparel|equipment|advertising|net interest|noninterest|interest|retail|wholesale) (revenue|revenues|sales|income)\b|\byear [1-3]\b|percentage points?|as a percentage of|\bmargins?\b|hypothetical|would have (increased|decreased)|\bsensitivity\b/i;

// Case-sensitive: a named owner or source that isn't the company itself -
// "FPL's net income" (NextEra's utility subsidiary), "Revenue from Digital
// Media" (an Adobe segment).
const NAMED_PART =
  /\b(?!Company|Corporation|Firm|Group)[A-Z][A-Za-z&.]*['\u2019]s (net income|net earnings|revenues?|operating (income|profit))|\b[Rr]evenues? from [A-Z][a-z]+/;

const PART_OF_BUSINESS =
  "the value is far below the company-wide figure, so it's about part of the business";

type Verdict = Pick<
  NarrativeClaim,
  "claimed" | "actual" | "tolerance" | "verdict" | "reason"
>;

function notChecked(reason: string): Verdict {
  return {
    claimed: null,
    actual: null,
    tolerance: null,
    verdict: "not_checked",
    reason,
  };
}

function checkAgainstLine(
  claim: RawClaim,
  line: Line,
  pageTolerance: number,
  parsedAs: ReturnType<typeof parseWritten>,
): Verdict | null {
  const { now, then } = line;
  if (claim.kind === "direction") {
    if (then == null || claim.direction === "none") return null;
    const up = now > then;
    return {
      claimed: null,
      actual: now - then,
      tolerance: null,
      verdict:
        (claim.direction === "up") === up ? "consistent" : "inconsistent",
      reason: `"${line.label}" ${up ? "increased" : "decreased"}`,
    };
  }
  const parsed = parsedAs;
  if (!parsed) return null;
  // The sign of a change comes from the verb ("decreased 4%"), not the digit.
  const signed = (v: number) =>
    claim.direction === "down" ? -Math.abs(v) : Math.abs(v);
  if (claim.kind === "percent_change") {
    if (!parsed.percent || then == null || then === 0) return null;
    const actual = ((now - then) / Math.abs(then)) * 100;
    const claimed = signed(parsed.value);
    return {
      claimed,
      actual,
      tolerance: parsed.tolerance,
      verdict:
        Math.abs(actual - claimed) <= parsed.tolerance + 1e-9
          ? "consistent"
          : "inconsistent",
      reason: `"${line.label}" changed ${actual.toFixed(2)}%`,
    };
  }
  if (parsed.percent) return null;
  // A figure printed in millions is only as precise as the page; don't hold
  // a claim to more than that.
  const tolerance = Math.max(parsed.tolerance, pageTolerance);
  // MD&A states levels for both years ("$22.3 billion and $20.2 billion
  // for fiscal 2026 and 2025"), so a stated value matches if it's either
  // year's figure for the line.
  const matchesLevel =
    Math.abs(Math.abs(now) - parsed.value) <= tolerance ||
    (then != null && Math.abs(Math.abs(then) - parsed.value) <= tolerance);
  if (claim.kind === "amount_change") {
    if (then == null) return null;
    const actual = now - then;
    const claimed = signed(parsed.value);
    // A "change" that is really one of the two levels ("were $10.7 billion
    // and $9.0 billion") is a value claim the agent mislabeled.
    const ok = Math.abs(actual - claimed) <= tolerance || matchesLevel;
    return {
      claimed,
      actual,
      tolerance,
      verdict: ok ? "consistent" : "inconsistent",
      reason: `"${line.label}" changed by ${actual}`,
    };
  }
  return {
    claimed: parsed.value,
    actual: now,
    tolerance,
    verdict: matchesLevel ? "consistent" : "inconsistent",
    reason: `"${line.label}" is ${now}${then != null ? ` (prior year ${then})` : ""}`,
  };
}

// Dollar amounts stated in a sentence, e.g. "$24.1 billion" -> 2.41e10.
function statedAmounts(quote: string): number[] {
  const out: number[] = [];
  for (const m of quote.matchAll(
    /\$\s?(\d[\d,]*(?:\.\d+)?)\s*(billion|million|thousand)?/gi,
  )) {
    const n = Number(m[1].replace(/,/g, ""));
    const unit = (m[2] ?? "").toLowerCase();
    out.push(
      n *
        (unit === "billion"
          ? 1e9
          : unit === "million"
            ? 1e6
            : unit === "thousand"
              ? 1e3
              : 1),
    );
  }
  return out;
}

function check(
  claim: RawClaim,
  fig: ExtractedFigure | undefined,
  tables: NarrativeTables,
  periodEnd: string,
  sentence: string,
): Verdict {
  if (claim.scope !== "consolidated") {
    return notChecked(
      "about a segment, region or non-GAAP measure, which the statements can't confirm",
    );
  }
  const named = NAMED_IN_TEXT[claim.field];
  if (named && !named.test(sentence)) {
    return notChecked("the sentence doesn't name this figure");
  }
  // Words that make a sentence about part of the company or an adjusted
  // measure, whatever scope the agent gave it (Coca-Cola's "$28.8 billion
  // of net operating revenues from operations outside the United States").
  if (PARTIAL_OR_ADJUSTED.test(sentence) || NAMED_PART.test(sentence)) {
    return notChecked(
      "the sentence is about a region, segment or adjusted measure",
    );
  }
  if (
    claim.kind !== "direction" &&
    !(() => {
      const token = claim.asWritten.match(/\d[\d,]*(?:\.\d+)?/)?.[0];
      return !!token && normalize(sentence).includes(token);
    })()
  ) {
    return notChecked("the claimed number isn't in the quoted sentence");
  }
  if (fig?.value == null || fig.failedChecks.length > 0) {
    return notChecked("the statement figure isn't available or failed a check");
  }
  // A stated current value under half the company-wide figure is a
  // segment's or a product line's, whatever the sentence says about scope.
  const parsed = parseWritten(claim.asWritten);
  if (
    claim.kind === "current_value" &&
    parsed &&
    !parsed.percent &&
    parsed.value < Math.abs(fig.value) / 2
  ) {
    return notChecked(PART_OF_BUSINESS);
  }
  // A growth rate or direction has no value of its own to test for scope,
  // but its sentence may state one: "Net revenue was $24.1 billion, up 12%"
  // at a company with $182 billion of revenue is one business's revenue.
  // A stated amount between a tenth and a half of the company-wide figure
  // is too big to be a change and too small to be the whole company. This
  // errs toward not checking a claim rather than raising a false alarm.
  if (
    (claim.kind === "percent_change" || claim.kind === "direction") &&
    statedAmounts(sentence).some((a) => {
      const share = a / Math.abs(fig.value!);
      return share > 0.1 && share < 0.5;
    })
  ) {
    return notChecked(PART_OF_BUSINESS);
  }
  const pageTolerance = fig.field === "epsDiluted" ? 0.005 : fig.scale / 2;
  // MD&A repeats last year's comparison ("Revenues decreased by $11,277
  // million in 2024 compared with 2023"). A sentence whose years don't
  // include the current fiscal year is about an earlier one. Retailers
  // label a year ending early in the calendar year by the year before, so
  // both count as current.
  const endYear = Number(periodEnd.slice(0, 4));
  const years = [...sentence.matchAll(/\b(19|20)\d{2}\b/g)].map((m) =>
    Number(m[0]),
  );
  const currentLabels = new Set([endYear]);
  if (Number(periodEnd.slice(5, 7)) <= 3) currentLabels.add(endYear - 1);
  if (years.length > 0 && !years.some((y) => currentLabels.has(y))) {

    return notChecked("the sentence is about an earlier year");
  }
  let lines = linesFor(fig, tables);
  // "From continuing operations" narrows the claim to that line; if the
  // statement doesn't print one, there's nothing to compare with.
  if (/continuing operations/i.test(sentence)) {
    lines = lines.filter((l) => /continuing/i.test(l.context));
    if (lines.length === 0) {
      return notChecked(
        "the claim is about continuing operations, which this statement line doesn't separate",
      );
    }
  }
  // A dollar amount with no scale word may be in the statements' unit
  // ("Net sales increased $20,287" in a report kept in millions), so both
  // readings are tried.
  const readings = [parsed];
  if (parsed?.bare && fig.field !== "epsDiluted" && fig.scale > 1) {
    readings.push({
      ...parsed,
      value: parsed.value * fig.scale,
      tolerance: parsed.tolerance * fig.scale,
    });
  }
  const results = lines
    .flatMap((line) =>
      readings.map((r) => checkAgainstLine(claim, line, pageTolerance, r)),
    )
    .filter((r): r is Verdict => r !== null);
  if (results.length === 0) {
    return notChecked("nothing on the statements to compare with");
  }
  // Consistent if the claim matches any line it could be describing;
  // otherwise reported against the extracted figure's own line.
  const best = results.find((r) => r.verdict === "consistent") ?? results[0];
  // "...increases of $2.1 billion and $3.9 billion for fiscal 2026 and
  // 2025, respectively": a sentence reporting several years can't be held
  // to one of them.
  if (best.verdict === "inconsistent" && /respectively/i.test(sentence)) {
    return notChecked("the sentence reports several years at once");
  }
  return best;
}

// The whole sentence around a quote, from the passage it came from. The
// agent sometimes quotes a fragment ("diluted EPS was $2.99, an increase of
// 18%") that drops what decides scope or year ("...in 2024").
function fullSentence(quote: string, passages: string[]): string {
  const squash = (x: string) => x.replace(/\s+/g, " ").trim();
  const q = squash(quote).toLowerCase();
  for (const passage of passages) {
    const text = squash(passage);
    const at = text.toLowerCase().indexOf(q);
    if (at === -1) continue;
    const before = text.slice(0, at);
    // Start after the last sentence end or bullet before the quote, or at
    // the start of the passage if there is none. (lastIndexOf returns -1
    // when there's nothing, which must not become an offset.)
    const dot = before.lastIndexOf(". ");
    const bullet = before.lastIndexOf("\u2022");
    const start = Math.max(dot === -1 ? 0 : dot + 2, bullet === -1 ? 0 : bullet + 1);
    const after = text.slice(at + q.length);
    const stop = after.search(/\.\s|\u2022/);
    return text.slice(start, at + q.length + (stop === -1 ? after.length : stop + 1)).trim();
  }
  return quote;
}

export async function checkNarrative(
  paragraphs: string[],
  figures: ExtractedFigure[],
  tables: NarrativeTables,
  periodEnd: string,
  printedElsewhere: Set<number> = new Set(),
): Promise<AgentStepResult<NarrativeClaim[]>> {
  const passages = findClaimPassages(paragraphs);
  const step = await runAgentStep({
    agentName: "narrative_checker",
    systemPrompt: PROMPT,
    userPrompt: passages.length
      ? passages.map((p, i) => `P${i + 1}: ${p}`).join("\n\n")
      : "No passages with year-over-year claims were found.",
    outputSchema: schema,
    mock: () => ({ output: { claims: [] } }),
  });
  return {
    ...step,
    output: verifyClaims(
      step.output.claims,
      passages,
      figures,
      tables,
      periodEnd,
      printedElsewhere,
    ),
  };
}

export type ClaimInput = RawClaim;

// Everything after the agent: quote verification, scope and wording rules,
// and the arithmetic. Pure code, exported so its power to catch a false
// claim can be tested without a model (scripts/test-narrative.ts).
export function verifyClaims(
  rawClaims: RawClaim[],
  passages: string[],
  figures: ExtractedFigure[],
  tables: NarrativeTables,
  periodEnd: string,
  // Every figure printed in the filing's other tables, in dollars.
  printedElsewhere: Set<number> = new Set(),
): NarrativeClaim[] {
  const haystack = normalize(passages.join(" "));
  const label = (k: FieldKey) => FIELDS.find((f) => f.key === k)?.label ?? k;
  // Scope belongs to the sentence: if any claim in a sentence is about a
  // segment or non-GAAP measure, so are the others in it.
  const segmentQuotes = new Set(
    rawClaims
      .filter((c) => c.scope !== "consolidated")
      .map((c) => normalize(c.quote)),
  );

  const judged = rawClaims.map((raw) => {
    const c: RawClaim = segmentQuotes.has(normalize(raw.quote))
      ? { ...raw, scope: "segment_or_non_gaap" }
      : raw;
    const quoteVerified =
      c.quote.length >= 20 && haystack.includes(normalize(c.quote));
    const result = quoteVerified
      ? check(
          c,
          figures.find((f) => f.field === c.field),
          tables,
          periodEnd,
          fullSentence(c.quote, passages),
        )
      : notChecked(
          "quote not found in the filing, so the claim isn't treated as real",
        );
    return { c, quoteVerified, result };
  });
  // Same rule as scope: once code finds a sentence states a value too small
  // to be company-wide ("Noninterest revenue was $17.2 billion, up 15%"),
  // every claim in that sentence is about that part of the business.
  const partQuotes = new Set(
    judged
      .filter((j) => j.result.reason === PART_OF_BUSINESS)
      .map((j) => normalize(j.c.quote)),
  );
  // A company reports one company-wide change for a line. When a filing's
  // claims give several different figures for the same line and kind of
  // change (CVS: "Total revenues increased" $12.7B, $16.8B, $14.9B in
  // successive segment bullets), the ones that don't match are about parts
  // of the business.
  const CONFLICTING =
    "several different figures are claimed for this line, so the ones that don't match are segment-level";
  const groups = new Map<string, Set<number>>();
  for (const j of judged) {
    if (j.result.verdict === "not_checked" || j.result.claimed === null) continue;
    const k = `${j.c.field}|${j.c.kind}`;
    groups.set(k, (groups.get(k) ?? new Set()).add(j.result.claimed));
  }
  for (const j of judged) {
    const k = `${j.c.field}|${j.c.kind}`;
    if (j.result.verdict === "inconsistent" && (groups.get(k)?.size ?? 0) > 1) {
      j.result = notChecked(CONFLICTING);
    }
  }
  // A stated value that misses the consolidated line but is printed
  // exactly in another of the filing's tables is that table's figure:
  // Caterpillar's MD&A quotes operating cash flow of $12.278 billion, the
  // figure its supplemental consolidating data prints for its
  // manufacturing businesses, while the consolidated statement says
  // $11.739 billion.
  const ELSEWHERE =
    "the value is a figure the filing prints for part of the business, not the consolidated line";
  for (const j of judged) {
    // Segment figures are dollar totals; per-share figures aren't split by
    // segment, and small numbers match too many unrelated cells.
    if (
      j.result.verdict !== "inconsistent" ||
      j.c.kind !== "current_value" ||
      j.c.field === "epsDiluted"
    ) {
      continue;
    }
    const parsed = parseWritten(j.c.asWritten);
    if (!parsed || parsed.percent) continue;
    // Held to the claim's own precision ("$12.278 billion" to $0.5M), so a
    // false claim can't hide behind a loosely similar number.
    const near = [...printedElsewhere].some(
      (v) => Math.abs(Math.abs(v) - parsed.value) <= parsed.tolerance,
    );
    if (near) j.result = notChecked(ELSEWHERE);
  }
  const claims: NarrativeClaim[] = judged.map(
    ({ c, quoteVerified, result }) => {
      const r =
        partQuotes.has(normalize(c.quote)) && result.verdict !== "not_checked"
          ? notChecked(PART_OF_BUSINESS)
          : result;
      return {
        field: c.field,
        kind: c.kind,
        asWritten: c.asWritten,
        quote: c.quote,
        quoteVerified,
        scope: c.scope,
        ...r,
        reason: `${label(c.field)}: ${r.reason}`,
      };
    },
  );
  return claims;
}
