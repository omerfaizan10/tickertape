import { getPool } from "../db";
import type { FilingRef } from "../sec/client";
import type { TraceEvent } from "./types";

export async function upsertFiling(
  filing: FilingRef & { ticker: string },
  source: "golden_set" | "live",
): Promise<void> {
  await getPool().query(
    `insert into filings (accession_number, ticker, cik, company_name, form,
       period_end, filing_date, url, source)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (accession_number) do nothing`,
    [
      filing.accessionNumber,
      filing.ticker,
      filing.cik,
      filing.companyName,
      filing.form,
      filing.reportDate,
      filing.filingDate,
      filing.url,
      source,
    ],
  );
}

export async function createRun(
  accessionNumber: string,
  model: string,
  promptVersion: string,
): Promise<string> {
  const { rows } = await getPool().query(
    `insert into runs (accession_number, model, prompt_version, status)
     values ($1, $2, $3, 'running') returning id`,
    [accessionNumber, model, promptVersion],
  );
  return rows[0].id;
}

export async function writeTraceEvent(
  runId: string,
  event: TraceEvent,
): Promise<void> {
  await getPool().query(
    `insert into trace_events
       (run_id, agent_name, step_index, parent_step_index, input, output,
        tool_calls, tokens_in, tokens_out, cost_usd, latency_ms, error)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      runId,
      event.agentName,
      event.stepIndex,
      event.parentStepIndex,
      JSON.stringify(event.input),
      JSON.stringify(event.output),
      JSON.stringify(event.toolCalls),
      event.tokensIn,
      event.tokensOut,
      event.costUsd,
      event.latencyMs,
      event.error,
    ],
  );
}

export async function finalizeRun(
  runId: string,
  result: {
    status: "completed" | "failed";
    result: unknown;
    checksPassed: number;
    checksTotal: number;
    retryCount: number;
    totalCostUsd: number;
    totalLatencyMs: number;
    error: string | null;
  },
): Promise<void> {
  await getPool().query(
    `update runs set ended_at = now(), status = $2, result = $3,
       checks_passed = $4, checks_total = $5, retry_count = $6,
       total_cost_usd = $7, total_latency_ms = $8, error = $9
     where id = $1`,
    [
      runId,
      result.status,
      JSON.stringify(result.result),
      result.checksPassed,
      result.checksTotal,
      result.retryCount,
      result.totalCostUsd,
      result.totalLatencyMs,
      result.error,
    ],
  );
}
