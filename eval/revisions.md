# Restatement detection evaluation

Run on 2026-09-28T07:49:06.082Z. Model: `gpt-6-luna`. Prompt version: `v4`.

For each golden-set filing the pipeline reads this year's 10-K and last year's. Code compares last year's figures as this year's 10-K reprints them against as last year's 10-K originally reported them, and flags anything more than rounding apart. Ground truth is the SEC's XBRL for both filings.

- **Prior-year figures compared:** 539 across 54 filing pairs
- **Actually revised (per XBRL):** 12
- **Precision:** 100.0% (12 of 12 flags were real)
- **Recall:** 100.0% (12 of 12 revisions caught)
- **False alarms:** 0 of 527 unrevised figures
- **Both amounts right on caught revisions:** 12/12

## Explanations (from the filings' own text, quotes checked word for word)

- **BAC** (revenue (Total revenue)): accounting change. The Corporation retrospectively changed accounting methods for certain tax-related equity investments. The change reclassifies income-statement items, including netting tax credits and benefits against investment expense, which explains the revised revenue presentation. Quote: "The primary impact of the accounting changes is a reclassification between income statement line items that nets income tax credits and benefits against the investment expense."
- **BAC** (netIncome (Net income attributable to the company), epsDiluted (Diluted EPS), totalAssets (Total assets), totalLiabilities (Total liabilities), totalEquity (Total shareholders' equity attributable to the company)): accounting change. The Corporation retrospectively changed accounting methods for certain tax-related equity investments, including a cumulative adjustment to retained earnings. The report says the changes had an insignificant impact on annualized net income, but does not specify how they account for each of these listed revisions. Quote: "The accounting changes were applied retrospectively to the earliest period presented, resulting in a cumulative adjustment that decreased retained earnings by $ 1.2 billion as of January 1, 2023."
- **C** (revenue (Total revenue)): unexplained. The passages do not explain why the reprinted total revenue is lower than originally reported. (no verified quote)
- **HON** (revenue (Total revenue)): discontinued operations. The Advanced Materials business was spun off, and its results are presented as discontinued operations for all periods. Removing those results from the reprinted comparative figures explains the lower revenue. Quote: "Results of operations, financial position, and cash flows for the Advanced Materials business are reported as discontinued operations for all periods presented and the notes to the financial statements have been adjusted on a retrospective basis."
- **HON** (cash (Cash and cash equivalents)): discontinued operations. The Advanced Materials business was spun off, and its financial position is presented as discontinued operations for all periods. Removing its financial position from the reprinted comparative figures explains the lower cash balance. Quote: "Results of operations, financial position, and cash flows for the Advanced Materials business are reported as discontinued operations for all periods presented and the notes to the financial statements have been adjusted on a retrospective basis."
- **LLY** (totalEquity): unexplained. The passage discusses a future disclosure standard and does not explain the change in shareholders’ equity. (no verified quote)
- **USB** (operatingCashFlow, financingCashFlow): unexplained. The passages do not explain the changes to these cash flow figures. (no verified quote)

## Every flag and every miss

| Filing | Field | Outcome | Originally (SEC) | Reprinted (SEC) | Detected |
|---|---|---|---|---|---|
| BAC | revenue | true positive | 101887000000 | 105856000000 | 101887000000 -> 105856000000 |
| BAC | netIncome | true positive | 27132000000 | 26973000000 | 27132000000 -> 26973000000 |
| BAC | epsDiluted | true positive | 3.21 | 3.19 | 3.21 -> 3.19 |
| BAC | totalAssets | true positive | 3261519000000 | 3261299000000 | 3261519000000 -> 3261299000000 |
| BAC | totalLiabilities | true positive | 2965960000000 | 2967336000000 | 2965960000000 -> 2967336000000 |
| BAC | totalEquity | true positive | 295559000000 | 293963000000 | 295559000000 -> 293963000000 |
| C | revenue | true positive | 81139000000 | 80722000000 | 81139000000 -> 80722000000 |
| HON | revenue | true positive | 38498000000 | 34717000000 | 38498000000 -> 34717000000 |
| HON | cash | true positive | 10567000000 | 9906000000 | 10567000000 -> 9906000000 |
| LLY | totalEquity | true positive | 14192100000 | 14272000000 | 14192100000 -> 14272000000 |
| USB | operatingCashFlow | true positive | 11273000000 | 11350000000 | 11273000000 -> 11350000000 |
| USB | financingCashFlow | true positive | 8571000000 | 8821000000 | 8571000000 -> 8821000000 |
