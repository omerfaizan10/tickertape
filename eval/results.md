# Tickertape evaluation

Run on 2026-09-27T18:58:29.510Z. Model: `gpt-4o-mini` (mode: live). Prompt version: `v3`.

Every figure is graded against the SEC's XBRL value for the same filing and period. Only figures printed on the statement the agents read are graded (539 of 542 in the golden set; see the golden set page for the 3 that aren't).

- **Filings:** 54 (54 completed)
- **Figure accuracy:** 537/539 (99.6%) exact, sign included
- **Right figure, any sign:** 537/539 (99.6%)
- **Matched the SEC's alternate concept** (both tagged and printed, e.g. Walmart's total revenues vs net sales): 1
- **Missing (agent said not printed):** 0  |  **wrong row:** 2  |  **wrong sign:** 0
- **Grounding mismatches** (agent misreported a printed figure; the cell was used instead): 0
- **Retries:** 16/54 filings needed one
- **Cost:** $0.0541 total, $0.0010 per filing; avg latency 2.4s per filing

## Accuracy by field

| Field | Correct | Graded | Accuracy |
|---|---|---|---|
| Total revenue | 51 | 51 | 100.0% |
| Operating income | 33 | 33 | 100.0% |
| Net income attributable to the company | 51 | 53 | 96.2% |
| Diluted EPS | 54 | 54 | 100.0% |
| Cash and cash equivalents | 47 | 47 | 100.0% |
| Total assets | 54 | 54 | 100.0% |
| Total liabilities | 37 | 37 | 100.0% |
| Total shareholders' equity attributable to the company | 48 | 48 | 100.0% |
| Net cash from operating activities | 54 | 54 | 100.0% |
| Net cash from investing activities | 54 | 54 | 100.0% |
| Net cash from financing activities | 54 | 54 | 100.0% |

## Accuracy by sector

| Sector | Correct | Graded | Accuracy |
|---|---|---|---|
| Technology | 107 | 107 | 100.0% |
| Financials | 97 | 99 | 98.0% |
| Healthcare | 98 | 98 | 100.0% |
| Consumer | 100 | 100 | 100.0% |
| Energy | 19 | 19 | 100.0% |
| Industrials | 79 | 79 | 100.0% |
| Telecom & Utilities | 37 | 37 | 100.0% |

## Reconciliation checks (after retries)

| Check | Passed | Applied | Pass rate |
|---|---|---|---|
| balance_identity | 53 | 53 | 100.0% |
| netIncome_before_preferred | 53 | 54 | 98.1% |
| epsDiluted_total | 54 | 54 | 100.0% |
| cash_flow_tie | 39 | 44 | 88.6% |
| totalEquity_attribution | 31 | 31 | 100.0% |
| netIncome_attribution | 27 | 28 | 96.4% |

## Misses

| Filing | Field | Outcome | Expected | Got | Row picked | Correct row(s) |
|---|---|---|---|---|---|---|
| GS | netIncome | wrong_value | 17176000000 | 16300000000 | Net earnings applicable to common shareholders | Net earnings |
| WFC | netIncome | wrong_value | 21338000000 | 21358000000 | Net income before noncontrolling interests | Wells Fargo net income |
