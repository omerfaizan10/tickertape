import type { FieldKey } from "../fields";
import type { StatementKind } from "../sec/locate-statements";

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
}

export interface AgentStepResult<T> {
  output: T;
  toolCalls: ToolCallRecord[];
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
}

export interface TraceEvent {
  agentName: string;
  stepIndex: number;
  parentStepIndex: number | null;
  input: unknown;
  output: unknown;
  toolCalls: ToolCallRecord[];
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  error: string | null;
}

// One extracted figure with everything needed to check it by hand: which
// statement row it came from, what was printed there, and how that became
// a number.
export interface ExtractedFigure {
  field: FieldKey;
  value: number | null;
  rowIndex: number | null;
  rowLabel: string | null;
  printed: string | null;
  scale: number;
  // The agent also reports the figure it read. When that disagrees with
  // the cell at the row it named, the agent misread something, and the
  // cell (not the agent's claim) is what's kept.
  agentPrinted: string | null;
  groundingMismatch: boolean;
  note: string;
}

export interface StatementExtraction {
  statement: StatementKind;
  tableIndex: number;
  currentColumn: number;
  figures: ExtractedFigure[];
}

export interface ReconciliationCheck {
  name: string;
  statement: StatementKind;
  passed: boolean;
  // A check is skipped, not failed, when the statement doesn't print what
  // it needs (no total liabilities line, no FX line).
  skipped: boolean;
  detail: string;
  // Fields implicated when it fails, so a retry targets only those.
  fields: FieldKey[];
}

export interface AnalysisResult {
  runId: string;
  accessionNumber: string;
  status: "completed" | "failed";
  figures: ExtractedFigure[];
  statements: StatementExtraction[];
  checks: ReconciliationCheck[];
  retryCount: number;
  totalCostUsd: number;
  totalLatencyMs: number;
  events: TraceEvent[];
  error: string | null;
}
