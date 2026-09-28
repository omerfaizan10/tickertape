import { z } from "zod";
import { runAgentStep } from "../llm/client";
import { FIELDS } from "../fields";
import type { Revision } from "../revisions";
import type { AgentStepResult } from "./types";

// When a filing reprints last year's figures differently from how they were
// first reported, the reason is in the filing's own prose: a spin-off
// recast into discontinued operations, an accounting standard adopted
// retrospectively, a reclassification "to conform to the current period
// presentation", or - the one that matters most - the correction of an
// error. This agent reads the passages most likely to say which, and must
// quote the sentence it relies on. Code then checks that the quote is
// really in that passage; an explanation it can't support is marked
// unverified rather than shown as fact.

export const CAUSES = [
  "discontinued_operations",
  "accounting_change",
  "reclassification",
  "error_correction",
  "acquisition_or_divestiture",
  "unexplained",
] as const;

export type Cause = (typeof CAUSES)[number];

export interface RevisionExplanation {
  fields: string[];
  cause: Cause;
  summary: string;
  passage: number | null;
  quote: string | null;
  // True only when the quote appears word for word in the cited passage.
  verified: boolean;
}

const MAX_PASSAGES = 8;
const MAX_PASSAGE_CHARS = 1500;

// Phrases that describe changes to prior periods, weighted by how
// specifically they do. Cover-page boilerplate ("indicate by check mark
// whether any of those error corrections are restatements") mentions
// restatements on every 10-K, so it's excluded outright.
const SIGNALS: [RegExp, number][] = [
  [/as previously reported/i, 5],
  [/\brecast\b/i, 5],
  [/retrospective(ly)?/i, 4],
  [/restate(d|ment)/i, 4],
  [/reclassified to conform|conform(ed)? to the current (period|year)/i, 4],
  [/prior[- ](period|year) (amounts|figures|results|financial statements)/i, 3],
  [/discontinued operations/i, 2],
  [/spin[- ]?off|separation of/i, 2],
  [/correction of (an )?error|immaterial error/i, 5],
  [/adopted|adoption of/i, 1],
];
const BOILERPLATE =
  /indicate by check mark|emerging growth company|forward-looking statements/i;

export function findRevisionPassages(paragraphs: string[]): string[] {
  return paragraphs
    .filter((p) => !BOILERPLATE.test(p))
    .map((p, i) => ({
      p,
      i,
      score: SIGNALS.reduce((s, [re, w]) => s + (re.test(p) ? w : 0), 0),
    }))
    .filter((x) => x.score >= 4)
    // Filings repeat whole paragraphs (U.S. Bancorp's segment note appears
    // twice); one copy is enough.
    .filter((x, i, all) => all.findIndex((y) => y.p === x.p) === i)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, MAX_PASSAGES)
    .map((x) => x.p.slice(0, MAX_PASSAGE_CHARS));
}

const schema = z.object({
  explanations: z.array(
    z.object({
      fields: z.array(z.string()),
      cause: z.enum(CAUSES),
      summary: z.string(),
      passage: z.number().int().nullable(),
      quote: z.string().nullable(),
    }),
  ),
});

const PROMPT = `You explain why a company's annual report (10-K) shows last year's figures differently from how last year's report originally showed them.

You get the revised figures (originally reported vs. as reprinted now) and numbered passages from the new report that discuss changes to prior periods.

For each distinct cause, return:
- fields: the revised figures it explains
- cause: one of discontinued_operations, accounting_change, reclassification, error_correction, acquisition_or_divestiture, unexplained
- summary: one or two plain sentences a reader can follow
- passage: the number of the passage you relied on, or null
- quote: one sentence copied EXACTLY, character for character, from that passage that supports the cause, or null

Rules:
- Only use what the passages say. If no passage explains a revision, use cause "unexplained" with passage and quote null.
- error_correction means the company says it corrected an error. Do not call something an error correction unless a passage says so.
- The quote must be copied exactly; it will be checked against the passage.`;

function normalize(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export async function explainRevisions(
  revisions: Revision[],
  paragraphs: string[],
): Promise<AgentStepResult<RevisionExplanation[]>> {
  const revised = revisions.filter((r) => r.revised);
  const passages = findRevisionPassages(paragraphs);
  const label = (k: string) => FIELDS.find((f) => f.key === k)?.label ?? k;

  const userPrompt = [
    "Revised figures (originally reported -> reprinted now):",
    ...revised.map(
      (r) =>
        `- ${r.field} (${label(r.field)}): ${r.original} -> ${r.reprinted}${r.pct !== null ? ` (${r.pct.toFixed(2)}%)` : ""}`,
    ),
    "",
    passages.length
      ? passages.map((p, i) => `P${i + 1}: ${p}`).join("\n\n")
      : "No passages about prior-period changes were found in the filing.",
  ].join("\n");

  const step = await runAgentStep({
    agentName: "revision_explainer",
    systemPrompt: PROMPT,
    userPrompt,
    outputSchema: schema,
    mock: () => ({
      output: {
        explanations: [
          {
            fields: revised.map((r) => r.field),
            cause: "unexplained" as const,
            summary: "Mock mode does not read passages.",
            passage: null,
            quote: null,
          },
        ],
      },
    }),
  });

  const explanations = step.output.explanations.map((e) => {
    const passage =
      e.passage !== null && e.passage >= 1 && e.passage <= passages.length
        ? passages[e.passage - 1]
        : null;
    const verified =
      !!passage &&
      !!e.quote &&
      e.quote.length >= 20 &&
      normalize(passage).includes(normalize(e.quote));
    return {
      ...e,
      // An unsupported quote is dropped rather than shown as evidence.
      quote: verified ? e.quote : null,
      verified,
    };
  });

  return { ...step, output: explanations };
}
