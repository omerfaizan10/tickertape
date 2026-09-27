import type { ReconciliationCheck } from "@/lib/agent/types";

const CHECK_LABEL: Record<string, string> = {
  row_has_figure: "picked row prints a figure",
  balance_identity: "assets = liabilities + equity",
  totalEquity_attribution: "equity excludes minority interests",
  netIncome_attribution: "net income excludes minority interests",
  cash_flow_tie: "cash flows tie to the change in cash",
  netIncome_before_preferred: "net income is before preferred dividends",
  epsDiluted_total: "diluted EPS is for total net income",
};

export function ChecksList({ checks }: { checks: ReconciliationCheck[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {checks.map((c, i) => (
        <li key={i} className="flex items-start gap-2 text-sm">
          <span
            className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
              c.skipped ? "bg-text-faint" : c.passed ? "bg-approve" : "bg-escalate"
            }`}
          />
          <span>
            <span className="text-text">{CHECK_LABEL[c.name] ?? c.name}</span>
            <span className="text-text-faint">
              {" "}
              · {c.skipped ? "not applicable: " : ""}
              {c.detail}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
