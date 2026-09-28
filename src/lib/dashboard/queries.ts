import { getPool } from "../db";
import type {
  ExtractedFigure,
  PriorYearCheck,
  ReconciliationCheck,
  StatementExtraction,
  TraceEvent,
} from "../agent/types";

export interface RunListItem {
  id: string;
  ticker: string;
  companyName: string;
  periodEnd: string;
  source: "golden_set" | "live";
  model: string;
  promptVersion: string;
  status: string;
  startedAt: string;
  checksPassed: number | null;
  checksTotal: number | null;
  retryCount: number;
  costUsd: number;
  latencyMs: number;
  correct: number | null;
  graded: number | null;
}

export async function listRuns(limit = 200): Promise<RunListItem[]> {
  const { rows } = await getPool().query(
    `select r.id, f.ticker, f.company_name, to_char(f.period_end, 'YYYY-MM-DD') as period_end,
            f.source, r.model, r.prompt_version, r.status, r.started_at,
            r.checks_passed, r.checks_total, r.retry_count,
            r.total_cost_usd, r.total_latency_ms,
            (select count(*) filter (where outcome = 'correct') from eval_scores e where e.run_id = r.id)::int as correct,
            (select count(*) from eval_scores e where e.run_id = r.id)::int as graded
     from runs r join filings f on f.accession_number = r.accession_number
     order by r.started_at desc
     limit $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    ticker: r.ticker,
    companyName: r.company_name,
    periodEnd: r.period_end,
    source: r.source,
    model: r.model,
    promptVersion: r.prompt_version,
    status: r.status,
    startedAt: r.started_at,
    checksPassed: r.checks_passed,
    checksTotal: r.checks_total,
    retryCount: r.retry_count,
    costUsd: Number(r.total_cost_usd),
    latencyMs: r.total_latency_ms,
    correct: r.graded > 0 ? r.correct : null,
    graded: r.graded > 0 ? r.graded : null,
  }));
}

export interface RunDetail extends RunListItem {
  accessionNumber: string;
  cik: number;
  filingDate: string;
  url: string;
  error: string | null;
  figures: ExtractedFigure[];
  statements: StatementExtraction[];
  checks: ReconciliationCheck[];
  priorYear: PriorYearCheck | null;
  events: TraceEvent[];
}

export async function getRun(id: string): Promise<RunDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const pool = getPool();
  const { rows } = await pool.query(
    `select r.*, f.ticker, f.company_name, f.cik, f.url, f.source,
            to_char(f.period_end, 'YYYY-MM-DD') as period_end,
            to_char(f.filing_date, 'YYYY-MM-DD') as filing_date,
            (select count(*) filter (where outcome = 'correct') from eval_scores e where e.run_id = r.id)::int as correct,
            (select count(*) from eval_scores e where e.run_id = r.id)::int as graded
     from runs r join filings f on f.accession_number = r.accession_number
     where r.id = $1`,
    [id],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  const events = await pool.query(
    `select agent_name, step_index, parent_step_index, input, output, tool_calls,
            tokens_in, tokens_out, cost_usd, latency_ms, error
     from trace_events where run_id = $1 order by step_index`,
    [id],
  );
  const result = r.result ?? { figures: [], statements: [], checks: [] };
  return {
    id: r.id,
    ticker: r.ticker,
    companyName: r.company_name,
    periodEnd: r.period_end,
    source: r.source,
    model: r.model,
    promptVersion: r.prompt_version,
    status: r.status,
    startedAt: r.started_at,
    checksPassed: r.checks_passed,
    checksTotal: r.checks_total,
    retryCount: r.retry_count,
    costUsd: Number(r.total_cost_usd),
    latencyMs: r.total_latency_ms,
    correct: r.graded > 0 ? r.correct : null,
    graded: r.graded > 0 ? r.graded : null,
    accessionNumber: r.accession_number,
    cik: r.cik,
    filingDate: r.filing_date,
    url: r.url,
    error: r.error,
    figures: result.figures,
    statements: result.statements,
    checks: result.checks,
    priorYear: result.priorYear ?? null,
    events: events.rows.map((e) => ({
      agentName: e.agent_name,
      stepIndex: e.step_index,
      parentStepIndex: e.parent_step_index,
      input: e.input,
      output: e.output,
      toolCalls: e.tool_calls ?? [],
      tokensIn: e.tokens_in,
      tokensOut: e.tokens_out,
      costUsd: Number(e.cost_usd),
      latencyMs: e.latency_ms,
      error: e.error,
    })),
  };
}
