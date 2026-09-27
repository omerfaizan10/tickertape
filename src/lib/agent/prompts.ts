import type { FieldKey } from "../fields";

// Bumped whenever a prompt changes, so eval runs can be compared across
// prompt versions instead of silently mixing them.
export const PROMPT_VERSION = "v3";

// What each field means, in the terms a statement actually uses. These are
// the distinctions that decide which row is right, and every one of them
// came from a real filing in the golden set.
export const FIELD_GUIDE: Record<FieldKey, string> = {
  revenue:
    'Total revenue for the whole company: the single total line ("Total net sales", "Total revenues", "Net revenues"). Revenue means sales of goods and services; it excludes other income, investment income and equity-affiliate income, so when a statement prints "Total revenues and other income", pick the revenue line above it that excludes the other income (e.g. "Sales and other operating revenues"). Banks: the total net revenue line, often "Total net revenue" or "Revenues, net of interest expense". Not a single product line, not interest income alone. If the statement never prints one company-wide revenue total, return null.',
  operatingIncome:
    'Operating income, under whatever name the company uses: "Operating income", "Income from operations", "Operating profit", "Operating earnings", "Earnings from operations", "Earnings/(loss) from operations". Many banks, insurers and some industrials do not print this line at all: return null rather than substituting pretax income.',
  netIncome:
    'Net income attributable to the company itself: the line that excludes noncontrolling (minority) interests, often "Net income attributable to <Company>". If the statement prints both a consolidated net income and an attributable one, use the attributable one. Use the figure before preferred dividends, not "available to common shareholders". If only one net income line exists, use it.',
  epsDiluted:
    "Diluted earnings per share for net income attributable to common shareholders. Not basic EPS. If diluted EPS is split into continuing and discontinued operations, use the total; if only a continuing-operations diluted figure is printed, use that.",
  cash: 'Cash and cash equivalents at the end of the period. Banks: the balance sheet\'s cash line ("Cash and due from banks" when that is the only cash line).',
  totalAssets: "Total assets.",
  totalLiabilities:
    'The "Total liabilities" line. Never "Total liabilities and equity". Many companies do not print a total liabilities line: return null in that case, do not add lines up.',
  totalEquity:
    "Total shareholders' (stockholders') equity attributable to the company, excluding noncontrolling interests. If the statement prints both a company-only equity total and a total including noncontrolling interests, use the company-only one. If there is only one equity total, use it.",
  operatingCashFlow:
    "Net cash provided by (used in) operating activities: the total for the section, not a subtotal before changes in working capital.",
  investingCashFlow:
    "Net cash provided by (used in) investing activities: the section total.",
  financingCashFlow:
    "Net cash provided by (used in) financing activities: the section total.",
};

export const EXTRACTION_PROMPT = `You read one financial statement from a company's annual report (Form 10-K) and find where specific figures are printed.

The statement is given as numbered rows: "R12: Total assets | 359,241 | 364,980". The first cell is the row label; the rest are the figures, one per period, in the order the columns are printed.

For each requested field, return:
- rowIndex: the number after "R" of the row that prints that figure, or null if the statement does not print it.
- printedValue: the figure exactly as printed in the current-period column of that row (you'll be told which column position that is), or null.
- note: one short sentence on why that row, especially when you chose between similar rows or returned null.

Rules:
- Only pick rows that are actually printed. Never compute, add up, or estimate a figure.
- Pick the most specific correct row. Totals, not sub-lines. Company-attributable, not consolidated-with-minority-interest, when both exist.
- A row with no label but a figure is usually a total printed under a rule line; you may pick it if it is clearly the requested total.
- Some labels are section headers with no figures ("Diluted earnings per share:"), and the figures sit on the rows beneath them ("Net income"). Always pick a row that has a figure in the current-period column.
- Returning null is correct when the line isn't there. A wrong row is worse than null.`;
