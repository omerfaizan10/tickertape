import { z } from "zod";
import { runAgentStep } from "../llm/client";
import { FIELDS, type FieldKey, type FieldSpec } from "../fields";
import type { FilingTable } from "../sec/filing-text";
import type { StatementKind } from "../sec/locate-statements";
import { detectScale, parseAmount } from "../sec/units";
import { EXTRACTION_PROMPT, FIELD_GUIDE } from "./prompts";
import {
  currentPeriodColumn,
  figureAt,
  renderForAgent,
  sameFigure,
} from "./statement-view";
import type {
  AgentStepResult,
  ExtractedFigure,
  StatementExtraction,
} from "./types";

const AGENT_NAME: Record<StatementKind, string> = {
  income: "income_extractor",
  balance: "balance_extractor",
  cashflow: "cashflow_extractor",
};

function outputSchema(keys: FieldKey[]) {
  return z.object({
    fields: z.array(
      z.object({
        field: z.enum(keys as [FieldKey, ...FieldKey[]]),
        rowIndex: z.number().int().nullable(),
        printedValue: z.string().nullable(),
        note: z.string(),
      }),
    ),
  });
}

type AgentAnswer = z.infer<ReturnType<typeof outputSchema>>["fields"][number];

// Without a model, the mock picks rows by label patterns. It exists to
// exercise the wiring, tracing and eval end to end for free; it is not a
// baseline anyone should read accuracy into.
const MOCK_PATTERNS: Record<FieldKey, RegExp> = {
  revenue:
    /^total (net )?(revenues?|sales)|^net sales$|^total net revenue|^revenues?$/i,
  operatingIncome: /^operating income|^income from operations/i,
  netIncome: /^net income attributable to (?!non)|^net (income|earnings)$/i,
  epsDiluted: /^diluted/i,
  cash: /^cash and cash equivalents/i,
  totalAssets: /^total assets/i,
  totalLiabilities: /^total liabilities$/i,
  totalEquity: /^total (stockholders|shareholders)['’]? equity/i,
  operatingCashFlow: /operating activities$/i,
  investingCashFlow: /investing activities$/i,
  financingCashFlow: /financing activities$/i,
};

function mockAnswer(
  table: FilingTable,
  specs: FieldSpec[],
  column: number,
): AgentAnswer[] {
  return specs.map((spec) => {
    const rowIndex = table.rows.findIndex(
      (r) => MOCK_PATTERNS[spec.key].test(r[0]) && figureAt(r, column) !== null,
    );
    return {
      field: spec.key,
      rowIndex: rowIndex === -1 ? null : rowIndex,
      printedValue:
        rowIndex === -1 ? null : figureAt(table.rows[rowIndex], column),
      note: "mock: label pattern match",
    };
  });
}

// Turns an agent's row choice into a number using only the page: the cell
// at that row and the current-period column, the statement's unit, and
// the printed sign. The agent's own reading of the figure is kept for
// comparison but never used as the value.
function resolve(
  table: FilingTable,
  spec: FieldSpec,
  answer: AgentAnswer | undefined,
  column: number,
): ExtractedFigure {
  const scale = spec.unit === "USD" ? detectScale(table) : 1;
  const base = {
    field: spec.key,
    scale,
    agentPrinted: answer?.printedValue ?? null,
    note: answer?.note ?? "no answer returned for this field",
  };
  const row =
    answer?.rowIndex !== null && answer?.rowIndex !== undefined
      ? table.rows[answer.rowIndex]
      : undefined;
  if (!row) {
    return {
      ...base,
      value: null,
      rowIndex: null,
      rowLabel: null,
      printed: null,
      groundingMismatch: false,
      note:
        answer?.rowIndex != null
          ? `row R${answer.rowIndex} does not exist`
          : base.note,
    };
  }
  const printed = figureAt(row, column);
  const amount = printed ? parseAmount(printed) : null;
  return {
    ...base,
    value: amount === null ? null : amount * scale,
    rowIndex: answer!.rowIndex,
    rowLabel: parseAmount(row[0]) === null ? row[0] : "(unlabeled total row)",
    printed,
    groundingMismatch:
      !!answer?.printedValue &&
      !!printed &&
      !sameFigure(answer.printedValue, printed),
  };
}

export async function runExtraction(
  kind: StatementKind,
  table: FilingTable,
  periodEnd: string,
  retryHint?: string,
): Promise<AgentStepResult<StatementExtraction>> {
  const specs = FIELDS.filter((f) => f.statement === kind);
  const column = currentPeriodColumn(table, periodEnd);
  const fieldList = specs
    .map((s) => `- ${s.key}: ${FIELD_GUIDE[s.key]}`)
    .join("\n");

  const userPrompt = [
    `Statement: ${kind === "income" ? "income statement" : kind === "balance" ? "balance sheet" : "cash flow statement"}.`,
    `The current period (fiscal year ending ${periodEnd}) is figure column ${column + 1} in each row (counting the figures after the label, starting at 1).`,
    retryHint
      ? `\nA previous attempt failed a consistency check: ${retryHint}\nRe-examine those fields carefully.`
      : "",
    `\nFields to find:\n${fieldList}`,
    `\nStatement rows:\n${renderForAgent(table)}`,
  ].join("\n");

  const step = await runAgentStep({
    agentName: AGENT_NAME[kind],
    systemPrompt: EXTRACTION_PROMPT,
    userPrompt,
    outputSchema: outputSchema(specs.map((s) => s.key)),
    mock: () => ({ output: { fields: mockAnswer(table, specs, column) } }),
  });

  const figures = specs.map((spec) =>
    resolve(
      table,
      spec,
      step.output.fields.find((f) => f.field === spec.key),
      column,
    ),
  );

  return {
    ...step,
    output: {
      statement: kind,
      tableIndex: table.index,
      currentColumn: column,
      figures,
    },
  };
}

export { AGENT_NAME };
