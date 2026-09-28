import type { FieldSpec } from "../fields";
import type { CompanyFacts } from "./answer-key";

// Ground truth for restatement detection, from the SEC's XBRL data only.
//
// Every 10-K reprints the prior year for comparison. When a company recasts
// or restates that year (a spin-off moved to discontinued operations, a new
// accounting standard adopted retrospectively, a reclassification), the
// reprinted figure differs from what last year's 10-K originally said. Both
// are tagged in XBRL: the original under last year's accession number, the
// reprint under this year's, for the same period end.

export interface RevisionTruth {
  // As last year's 10-K originally reported it.
  original: number;
  // As this year's 10-K reprints it.
  reprinted: number;
  concept: string;
  // More than rounding apart. A company that switches from reporting in
  // thousands to millions (Eli Lilly) reprints 3,268.4 as 3,268: that is
  // not a restatement.
  revised: boolean;
}

function days(start: string, end: string): number {
  return (Date.parse(end) - Date.parse(start)) / 86400000;
}

function annualOrInstant(
  f: { start?: string; end: string },
  duration: boolean,
): boolean {
  return duration
    ? f.start !== undefined &&
        days(f.start, f.end) >= 330 &&
        days(f.start, f.end) <= 400
    : f.start === undefined;
}

export function revisionTruth(
  facts: CompanyFacts,
  spec: FieldSpec,
  concept: string,
  currentAccn: string,
  priorAccn: string,
  priorPeriodEnd: string,
  roundingTolerance: number,
): RevisionTruth | null {
  const list = facts.facts["us-gaap"]?.[concept]?.units?.[spec.unit] ?? [];
  const pick = (accn: string) => {
    const values = new Set(
      list
        .filter(
          (f) =>
            f.accn === accn &&
            f.end === priorPeriodEnd &&
            annualOrInstant(f, spec.duration),
        )
        .map((f) => f.val),
    );
    return values.size === 1 ? [...values][0] : null;
  };
  const original = pick(priorAccn);
  const reprinted = pick(currentAccn);
  if (original === null || reprinted === null) return null;
  return {
    original,
    reprinted,
    concept,
    revised: Math.abs(reprinted - original) > roundingTolerance,
  };
}
