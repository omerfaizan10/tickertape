import type { FieldKey } from "../fields";
import type { FilingTable } from "../sec/filing-text";
import type { StatementKind } from "../sec/locate-statements";
import { detectScale, parseAmount } from "../sec/units";
import { figureAt, headerAbove, sameFigure } from "./statement-view";
import type {
  ExtractedFigure,
  ReconciliationCheck,
  StatementExtraction,
} from "./types";

// Consistency checks on what the extraction agents picked, using nothing
// but what the statements themselves print. Accounting identities are
// arithmetic, not judgment - the same lesson AgentLens learned the hard
// way - so a model never grades its own work here. A failed check names
// the fields it implicates, and only those statements get retried.

interface Located {
  table: FilingTable;
  extraction: StatementExtraction;
}

function rowValues(
  table: FilingTable,
  column: number,
  label: RegExp,
): number[] {
  const scale = detectScale(table);
  return table.rows
    .filter((r) => label.test(r[0]))
    .map((r) => figureAt(r, column))
    .map((c) => (c ? parseAmount(c) : null))
    .filter((n): n is number => n !== null)
    .map((n) => n * scale);
}

function fig(
  e: StatementExtraction,
  field: FieldKey,
): ExtractedFigure | undefined {
  return e.figures.find((f) => f.field === field);
}

function close(a: number, b: number, scale: number): boolean {
  // Each printed figure is rounded to the unit, so sums of several can be
  // off by a unit or two.
  return Math.abs(a - b) <= scale * 2;
}

function check(
  name: string,
  statement: StatementKind,
  fields: FieldKey[],
  result: { passed: boolean; skipped?: boolean; detail: string },
): ReconciliationCheck {
  return {
    name,
    statement,
    fields,
    passed: result.passed,
    skipped: result.skipped ?? false,
    detail: result.detail,
  };
}

// A picked row that prints nothing in the current column is a section
// header ("Diluted earnings per share:"), not an answer.
function rowsHaveFigures(e: StatementExtraction): ReconciliationCheck[] {
  return e.figures
    .filter((f) => f.rowIndex !== null && f.printed === null)
    .map((f) =>
      check("row_has_figure", e.statement, [f.field], {
        passed: false,
        detail: `${f.field}: row R${f.rowIndex} ("${f.rowLabel}") prints no figure in the current-period column. It is probably a section header; the figure is on a row beneath it.`,
      }),
    );
}

function balanceIdentity({
  table,
  extraction: e,
}: Located): ReconciliationCheck {
  const assets = fig(e, "totalAssets")?.value;
  const scale = detectScale(table);
  const labeled = rowValues(
    table,
    e.currentColumn,
    /^total liabilities[,]?( and| &)?.*(equity|capital|investment)/i,
  );
  // Merck prints its totals with no labels at all, so the line can't be
  // found by name. A balance sheet always ends on total liabilities and
  // equity, so the last row with a figure is it.
  const lastFigure = [...table.rows]
    .reverse()
    .map((r) => figureAt(r, e.currentColumn))
    .find((c) => c !== null && parseAmount(c) !== null);
  const totals =
    labeled.length > 0
      ? labeled
      : lastFigure
        ? [parseAmount(lastFigure)! * scale]
        : [];
  if (assets == null || totals.length === 0) {
    return check("balance_identity", "balance", ["totalAssets"], {
      passed: true,
      skipped: true,
      detail: "statement prints no total liabilities and equity line",
    });
  }
  const passed = totals.some((t) =>
    close(Math.abs(t), Math.abs(assets), scale),
  );
  return check("balance_identity", "balance", ["totalAssets"], {
    passed,
    detail: passed
      ? "total assets equals total liabilities and equity"
      : `total assets ${assets} does not equal the printed total liabilities and equity (${totals.join(", ")})`,
  });
}

// When a statement prints a noncontrolling-interest line, the total that
// includes minority interests and the one that doesn't differ by exactly
// that line, and statements print them in a fixed order:
//   income statement: consolidated net income, then NCI, then attributable
//   balance sheet:    company equity, then NCI, then total equity
// So the agent took the including-NCI total when, reading in that order,
// its row is followed (or, for equity, preceded) by an NCI line and then a
// row that differs from it by exactly the NCI amount. Signs are compared
// both ways: minority interests can be negative (Deere) and equity can be
// a deficit (AbbVie, Starbucks).
function attribution(
  { table, extraction: e }: Located,
  field: FieldKey,
  statement: StatementKind,
  what: string,
): ReconciliationCheck {
  const picked = fig(e, field);
  const scale = detectScale(table);
  const valueAt = (i: number): number | null => {
    const c = figureAt(table.rows[i], e.currentColumn);
    const n = c ? parseAmount(c) : null;
    return n === null ? null : n * scale;
  };
  const nciRows = table.rows
    .map((r, i) => i)
    .filter((i) =>
      /noncontrolling|non-controlling|minority/i.test(table.rows[i][0]),
    )
    .filter((i) => {
      const v = valueAt(i);
      return v !== null && v !== 0;
    });
  if (
    picked?.value == null ||
    picked.rowIndex === null ||
    nciRows.length === 0
  ) {
    return check(`${field}_attribution`, statement, [field], {
      passed: true,
      skipped: true,
      detail: "no noncontrolling interest line printed",
    });
  }
  const p = picked.rowIndex;
  // Income: the including-NCI line comes first. Balance: it comes last.
  const includingComesFirst = statement === "income";
  const includesNci = nciRows.some((n) => {
    const nci = valueAt(n)!;
    const between = includingComesFirst ? p < n : n < p;
    if (!between) return false;
    const others = includingComesFirst
      ? table.rows.map((_, i) => i).filter((i) => i > n)
      : table.rows.map((_, i) => i).filter((i) => i < n);
    return others.some((i) => {
      const v = valueAt(i);
      return (
        v !== null &&
        !close(v, picked.value!, scale) &&
        (close(v + nci, picked.value!, scale) ||
          close(v - nci, picked.value!, scale))
      );
    });
  });
  return check(`${field}_attribution`, statement, [field], {
    passed: !includesNci,
    detail: includesNci
      ? `${field} ${picked.value} is the total including noncontrolling interests: the ${what} attributable to the company is printed separately and differs by the noncontrolling interest line. Pick the row attributable to the company.`
      : `${field} excludes noncontrolling interests`,
  });
}

function cashFlowTie({ table, extraction: e }: Located): ReconciliationCheck {
  const fields: FieldKey[] = [
    "operatingCashFlow",
    "investingCashFlow",
    "financingCashFlow",
  ];
  const [ocf, icf, fcf] = fields.map((f) => fig(e, f)?.value);
  const scale = detectScale(table);
  const change = rowValues(
    table,
    e.currentColumn,
    /^net (increase|decrease|change)|(increase|decrease) in cash/i,
  );
  if (ocf == null || icf == null || fcf == null || change.length === 0) {
    return check("cash_flow_tie", "cashflow", fields, {
      passed: true,
      skipped: true,
      detail: "missing a section total or no net change in cash line",
    });
  }
  const fx = rowValues(
    table,
    e.currentColumn,
    /exchange rate|foreign currency/i,
  );
  const sum = ocf + icf + fcf;
  const passed = change.some(
    (c) => close(sum, c, scale) || fx.some((x) => close(sum + x, c, scale)),
  );
  return check("cash_flow_tie", "cashflow", fields, {
    passed,
    detail: passed
      ? "operating + investing + financing (+ FX) equals the net change in cash"
      : `operating + investing + financing = ${sum}, but the printed net change in cash is ${change.join(" or ")}${fx.length ? ` (FX effect ${fx.join(", ")})` : ""}`,
  });
}

// Net income is the figure before preferred dividends. Banks also print
// "net income applicable to common stockholders" below it, and the agent
// took that line in 4 of 54 filings despite being told not to. When the
// pick is that line and a plain net income line is printed above it, the
// pick is wrong - a label fact, so code checks it.
function netIncomeBeforePreferred({
  table,
  extraction: e,
}: Located): ReconciliationCheck {
  const picked = fig(e, "netIncome");
  const toCommon = /(available|applicable|attributable) to common/i;
  if (picked?.rowIndex == null || !toCommon.test(picked.rowLabel ?? "")) {
    return check("netIncome_before_preferred", "income", ["netIncome"], {
      passed: true,
      skipped: picked?.rowIndex == null,
      detail: "net income is not the after-preferred-dividends line",
    });
  }
  const plainAbove = table.rows
    .slice(0, picked.rowIndex)
    .some(
      (r) =>
        /^(.*\b)?net (income|earnings)\b/i.test(r[0]) &&
        !toCommon.test(r[0]) &&
        !/per share|noncontrolling|minority|continuing|discontinued/i.test(
          r[0],
        ) &&
        figureAt(r, e.currentColumn) !== null,
    );
  return check("netIncome_before_preferred", "income", ["netIncome"], {
    passed: !plainAbove,
    detail: plainAbove
      ? `netIncome was read from "${picked.rowLabel}", which is after preferred dividends. Net income is the line before preferred dividends, printed above it.`
      : "no net income line before preferred dividends is printed",
  });
}

// Diluted EPS is for total net income. GE prints a diluted EPS row under
// "Earnings per share from continuing operations" and another under "Net
// earnings per share"; the agent took the continuing one. When the picked
// row sits under a continuing-operations header and another diluted row
// with a different figure sits under a header that isn't, the pick is the
// wrong one.
function epsTotal({ table, extraction: e }: Located): ReconciliationCheck {
  const picked = fig(e, "epsDiluted");
  if (picked?.rowIndex == null) {
    return check("epsDiluted_total", "income", ["epsDiluted"], {
      passed: true,
      skipped: true,
      detail: "no diluted EPS picked",
    });
  }
  const underContinuing = (i: number) =>
    /continuing operations/i.test(
      `${table.rows[i][0]} ${headerAbove(table, i, e.currentColumn)}`,
    ) && !/discontinued/i.test(table.rows[i][0]);
  const otherTotal =
    underContinuing(picked.rowIndex) &&
    table.rows.some(
      (r, i) =>
        i !== picked.rowIndex &&
        /dilut/i.test(`${r[0]} ${headerAbove(table, i, e.currentColumn)}`) &&
        // An EPS row, not a share count: "weighted-average diluted shares
        // outstanding" also says diluted, and J&J and Duke print share
        // counts as a bare "Diluted" row under an average-shares header.
        !/shares|weighted|average/i.test(
          `${r[0]} ${headerAbove(table, i, e.currentColumn)}`,
        ) &&
        parseAmount(figureAt(r, e.currentColumn) ?? "") !== null &&
        figureAt(r, e.currentColumn) !== null &&
        // Same figure means no discontinued operations to speak of, and
        // either row is right.
        !sameFigure(figureAt(r, e.currentColumn)!, picked.printed ?? "") &&
        !underContinuing(i) &&
        !/discontinued/i.test(
          `${r[0]} ${headerAbove(table, i, e.currentColumn)}`,
        ),
    );
  return check("epsDiluted_total", "income", ["epsDiluted"], {
    passed: !otherTotal,
    detail: otherTotal
      ? `epsDiluted was read from a continuing-operations row, but a diluted EPS for total net earnings is also printed. Use the total one.`
      : "diluted EPS is for total net income",
  });
}

// Only checks measured to have essentially no false alarms on correct
// answers may trigger a retry: a retry on a false alarm can talk the agent
// out of a right answer. The cash flow tie breaks on legitimate extra
// lines (discontinued operations, restricted cash) in about 1 filing in 9,
// so it is reported but never acted on.
export const RETRYABLE_CHECKS = new Set([
  "row_has_figure",
  "netIncome_before_preferred",
  "epsDiluted_total",
  "balance_identity",
  "totalEquity_attribution",
  "netIncome_attribution",
]);

export function reconcile(
  located: Partial<Record<StatementKind, Located>>,
): ReconciliationCheck[] {
  const checks: ReconciliationCheck[] = [];
  for (const l of Object.values(located)) {
    if (l) checks.push(...rowsHaveFigures(l.extraction));
  }
  if (located.balance) {
    checks.push(balanceIdentity(located.balance));
    checks.push(
      attribution(located.balance, "totalEquity", "balance", "equity total"),
    );
  }
  if (located.income) {
    checks.push(netIncomeBeforePreferred(located.income));
    checks.push(epsTotal(located.income));
    checks.push(
      attribution(located.income, "netIncome", "income", "net income line"),
    );
  }
  if (located.cashflow) checks.push(cashFlowTie(located.cashflow));
  return checks;
}
