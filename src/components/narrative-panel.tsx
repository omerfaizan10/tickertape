import type { NarrativeClaim } from "@/lib/agent/narrative";

// Management's year-over-year claims next to what the statements say. Only
// claims code could check are shown up front; the rest are counted, since
// a segment or non-GAAP claim can't be confirmed from the statements.
export function NarrativePanel({ claims }: { claims: NarrativeClaim[] }) {
  const checked = claims.filter((c) => c.verdict !== "not_checked");
  const inconsistent = checked.filter((c) => c.verdict === "inconsistent");
  const skipped = claims.length - checked.length;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-muted">
        {claims.length === 0
          ? "No year-over-year claims about the headline figures were found in management's discussion."
          : checked.length === 0
            ? `Found ${claims.length} claims, none about a company-wide figure the statements can confirm.`
            : inconsistent.length === 0
              ? `${checked.length === 1 ? "The one checkable claim" : `All ${checked.length} checkable claims`} in management's discussion ${checked.length === 1 ? "matches" : "match"} the statements.`
              : `${inconsistent.length} of ${checked.length} checkable claims don't match the statements.`}
        {skipped > 0 && checked.length > 0 ? (
          <span className="text-text-faint">
            {" "}
            {skipped === 1 ? "1 more was" : `${skipped} more were`} about segments,
            regions or adjusted measures and {skipped === 1 ? "wasn't" : "weren't"} checked.
          </span>
        ) : null}
      </p>
      {checked.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {checked.map((c, i) => (
            <li
              key={i}
              className="rounded-lg border border-border-soft bg-surface p-3"
            >
              <div className="flex flex-wrap items-baseline gap-2 text-xs">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${c.verdict === "consistent" ? "bg-approve" : "bg-escalate"}`}
                />
                <span className="text-text">
                  {c.verdict === "consistent" ? "matches" : "doesn't match"}
                </span>
                <span className="text-text-faint">{c.reason}</span>
              </div>
              <blockquote className="mt-2 border-l-2 border-border pl-3 text-xs italic text-text-muted">
                &ldquo;{c.quote}&rdquo;
              </blockquote>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
