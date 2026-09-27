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
