import type { StatementKind } from "./sec/locate-statements";

// The figures the pipeline extracts and the eval grades. Each maps to the
// statement it's read from and to the XBRL concepts the SEC may file it
// under, in order of preference. Companies pick different concepts for the
// same line (revenue especially), so the answer key tries each and keeps
// the one whose value actually appears on the statement.

export type FieldKey =
  | "revenue"
  | "operatingIncome"
  | "netIncome"
  | "epsDiluted"
  | "cash"
  | "totalAssets"
  | "totalLiabilities"
  | "totalEquity"
  | "operatingCashFlow"
  | "investingCashFlow"
  | "financingCashFlow";

export interface FieldSpec {
  key: FieldKey;
  label: string;
  statement: StatementKind;
  concepts: string[];
  unit: "USD" | "USD/shares";
  // Income and cash flow lines cover a period; balance sheet lines are a
  // point in time.
  duration: boolean;
}

export const FIELDS: FieldSpec[] = [
  {
    key: "revenue",
    label: "Total revenue",
    statement: "income",
    concepts: [
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "Revenues",
      "RevenuesNetOfInterestExpense",
      "SalesRevenueNet",
    ],
    unit: "USD",
    duration: true,
  },
  {
    key: "operatingIncome",
    label: "Operating income",
    statement: "income",
    concepts: ["OperatingIncomeLoss"],
    unit: "USD",
    duration: true,
  },
  {
    key: "netIncome",
    label: "Net income attributable to the company",
    statement: "income",
    concepts: ["NetIncomeLoss"],
    unit: "USD",
    duration: true,
  },
  {
    key: "epsDiluted",
    label: "Diluted EPS",
    statement: "income",
    concepts: ["EarningsPerShareDiluted"],
    unit: "USD/shares",
    duration: true,
  },
  {
    key: "cash",
    label: "Cash and cash equivalents",
    statement: "balance",
    concepts: ["CashAndCashEquivalentsAtCarryingValue", "CashAndDueFromBanks"],
    unit: "USD",
    duration: false,
  },
  {
    key: "totalAssets",
    label: "Total assets",
    statement: "balance",
    concepts: ["Assets"],
    unit: "USD",
    duration: false,
  },
  {
    key: "totalLiabilities",
    label: "Total liabilities",
    statement: "balance",
    concepts: ["Liabilities"],
    unit: "USD",
    duration: false,
  },
  {
    key: "totalEquity",
    label: "Total shareholders' equity attributable to the company",
    statement: "balance",
    concepts: ["StockholdersEquity"],
    unit: "USD",
    duration: false,
  },
  {
    key: "operatingCashFlow",
    label: "Net cash from operating activities",
    statement: "cashflow",
    concepts: ["NetCashProvidedByUsedInOperatingActivities"],
    unit: "USD",
    duration: true,
  },
  {
    key: "investingCashFlow",
    label: "Net cash from investing activities",
    statement: "cashflow",
    concepts: ["NetCashProvidedByUsedInInvestingActivities"],
    unit: "USD",
    duration: true,
  },
  {
    key: "financingCashFlow",
    label: "Net cash from financing activities",
    statement: "cashflow",
    concepts: ["NetCashProvidedByUsedInFinancingActivities"],
    unit: "USD",
    duration: true,
  },
];
