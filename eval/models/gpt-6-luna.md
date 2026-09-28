# Tickertape evaluation

Run on 2026-09-28T07:44:38.619Z. Model: `gpt-6-luna` (mode: live). Prompt version: `v4`.

Every figure is graded against the SEC's XBRL value for the same filing and period. Only figures printed on the statement the agents read are graded (539 of 542 in the golden set; see the golden set page for the 3 that aren't).

- **Filings:** 54 (54 completed)
- **Figure accuracy:** 544/545 (99.8%) exact, sign included
- **Right figure, any sign:** 544/545 (99.8%)
- **Matched the SEC's alternate concept** (both tagged and printed, e.g. Walmart's total revenues vs net sales): 1
- **Missing (agent said not printed):** 0  |  **wrong row:** 1  |  **wrong sign:** 0
- **Grounding mismatches** (agent misreported a printed figure; the cell was used instead): 0
- **Retries:** 0/54 filings needed one
- **Cost:** $0.0378 total, $0.0007 per filing; avg latency 3.4s per filing

## Accuracy by field

| Field | Correct | Graded | Accuracy |
|---|---|---|---|
| Total revenue | 50 | 51 | 98.0% |
| Operating income | 33 | 33 | 100.0% |
| Net income attributable to the company | 53 | 53 | 100.0% |
| Diluted EPS | 54 | 54 | 100.0% |
| Cash and cash equivalents | 53 | 53 | 100.0% |
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
| Financials | 100 | 100 | 100.0% |
| Healthcare | 98 | 98 | 100.0% |
| Consumer | 103 | 103 | 100.0% |
| Energy | 19 | 19 | 100.0% |
| Industrials | 80 | 81 | 98.8% |
| Telecom & Utilities | 37 | 37 | 100.0% |

## Reconciliation checks (after retries)

| Check | Passed | Applied | Pass rate |
|---|---|---|---|
| balance_identity | 54 | 54 | 100.0% |
| netIncome_before_preferred | 54 | 54 | 100.0% |
| epsDiluted_total | 54 | 54 | 100.0% |
| cash_flow_tie | 39 | 44 | 88.6% |
| totalEquity_attribution | 29 | 29 | 100.0% |
| netIncome_attribution | 28 | 28 | 100.0% |

## Misses

| Filing | Field | Outcome | Expected | Got | Row picked | Correct row(s) |
|---|---|---|---|---|---|---|
| DE | revenue | wrong_value | 45684000000 | 38917000000 | Net sales | Total |
