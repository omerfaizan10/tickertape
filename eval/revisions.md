# Restatement detection evaluation

Run on 2026-09-28T07:03:05.840Z. Model: `gpt-4o-mini`. Prompt version: `v3`.

For each golden-set filing the pipeline reads this year's 10-K and last year's. Code compares last year's figures as this year's 10-K reprints them against as last year's 10-K originally reported them, and flags anything more than rounding apart. Ground truth is the SEC's XBRL for both filings.

- **Prior-year figures compared:** 533 across 54 filing pairs
- **Actually revised (per XBRL):** 12
- **Precision:** 100.0% (12 of 12 flags were real)
- **Recall:** 100.0% (12 of 12 revisions caught)
- **False alarms:** 0 of 521 unrevised figures
- **Both amounts right on caught revisions:** 12/12

## Explanations (from the filings' own text, quotes checked word for word)

- **BAC** (revenue): accounting change. The increase in total revenue is due to a change in accounting methods applied retrospectively to align financial presentation with the economic impact of certain equity investments. Quote: "The primary impact of the accounting changes is a reclassification between income statement line items that nets income tax credits and benefits against the investment expense."
- **BAC** (netIncome, epsDiluted, totalAssets, totalLiabilities, totalEquity): accounting change. Net income, diluted EPS, total assets, total liabilities, and total equity reflect the retroactive application of revised accounting methods for certain tax-related equity investments. Quote: "Certain prior-period information presented herein has been revised to reflect the accounting method changes."
- **C** (revenue (Total revenue)): reclassification. The figure for total revenue has been updated due to certain reclassifications and updates made to prior periods’ financial statements. Quote: "Certain reclassifications and updates have been made to the prior periods’ financial statements and notes to conform to the current period’s presentation."
- **HON** (revenue (Total revenue), cash (Cash and cash equivalents)): discontinued operations. The revenue and cash figures were revised because they now exclude the financial results of the Advanced Materials business, which has been classified as discontinued operations due to its spin-off. Quote: "Results of operations, financial position, and cash flows for the Advanced Materials business are reported as discontinued operations for all periods presented and the notes to the financial statements have been adjusted on a retrospective basis."
- **HON** (revenue (Total revenue), cash (Cash and cash equivalents)): reclassification. The revised revenue and cash figures reflect a reclassification of some amounts in the financial statements to align with the current year's presentation format. Quote: "Certain prior year amounts are reclassified to conform to the current year presentation."
- **LLY** (totalLiabilities): unexplained. The change in total liabilities is not explicitly explained in the current report. (no verified quote)
- **LLY** (totalEquity): unexplained. The revision in total equity lacks any specific explanation in the current report. (no verified quote)
- **USB** (operatingCashFlow): reclassification. The operating cash flow was revised due to changes in the company's methods of evaluating performance and realigning business segments, resulting in prior period results being recast for comparability. Quote: "Prior period results were recast and presented on a comparable basis."
- **USB** (financingCashFlow): reclassification. The financing cash flow was revised because the company's methodology for designations and allocations changed, which affected how prior period results were presented. Quote: "Certain items in prior periods have been reclassified to conform to the current period presentation."

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
