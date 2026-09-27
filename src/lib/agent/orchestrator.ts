import { CHAT_MODEL, isMockMode } from "../llm/client";
import type { FilingRef } from "../sec/client";
import { parseFiling, type FilingTable } from "../sec/filing-text";
import { loadFilingDocuments } from "../sec/filing-source";
import { locateStatement, type StatementKind } from "../sec/locate-statements";
import { detectScale } from "../sec/units";
import { AGENT_NAME, runExtraction } from "./extract";
import { PROMPT_VERSION } from "./prompts";
import { reconcile, RETRYABLE_CHECKS } from "./reconcile";
import { createRun, finalizeRun, upsertFiling, writeTraceEvent } from "./trace";
import type {
  AgentStepResult,
  AnalysisResult,
  ReconciliationCheck,
  StatementExtraction,
  TraceEvent,
} from "./types";

// The pipeline for one 10-K:
//
//   locator (code)  ->  income / balance / cash flow extractors (parallel)
//                   ->  reconciler (code)  ->  targeted retry (once)
//
// Only the extractors call a model. Finding the statements, reading the
// cell, applying units and checking the results are all code, so every
// figure is traceable to a printed cell and every check is reproducible.

const KINDS: StatementKind[] = ["income", "balance", "cashflow"];
const MAX_RETRIES = 1;

export interface RunOptions {
  source?: "golden_set" | "live";
  onEvent?: (event: TraceEvent) => void;
}

export async function analyzeFiling(
  ticker: string,
  filing: FilingRef,
  options: RunOptions = {},
): Promise<AnalysisResult> {
  const started = Date.now();
  const model = isMockMode() ? "mock" : CHAT_MODEL;
  await upsertFiling({ ...filing, ticker }, options.source ?? "live");
  const runId = await createRun(filing.accessionNumber, model, PROMPT_VERSION);

  const events: TraceEvent[] = [];
  let totalCost = 0;
  const record = async (event: TraceEvent) => {
    events.push(event);
    totalCost += event.costUsd;
    await writeTraceEvent(runId, event);
    options.onEvent?.(event);
  };
  const stepEvent = <T>(
    agentName: string,
    parentStepIndex: number | null,
    input: unknown,
    step: Omit<AgentStepResult<T>, "output"> & { output: unknown },
    error: string | null = null,
  ): TraceEvent => ({
    agentName,
    stepIndex: events.length,
    parentStepIndex,
    input,
    output: step.output,
    toolCalls: step.toolCalls,
    tokensIn: step.tokensIn,
    tokensOut: step.tokensOut,
    costUsd: step.costUsd,
    latencyMs: step.latencyMs,
    error,
  });

  const fail = async (message: string): Promise<AnalysisResult> => {
    const result: AnalysisResult = {
      runId,
      accessionNumber: filing.accessionNumber,
      status: "failed",
      figures: [],
      statements: [],
      checks: [],
      retryCount: 0,
      totalCostUsd: totalCost,
      totalLatencyMs: Date.now() - started,
      events,
      error: message,
    };
    await finalizeRun(runId, {
      status: "failed",
      result: null,
      checksPassed: 0,
      checksTotal: 0,
      retryCount: 0,
      totalCostUsd: totalCost,
      totalLatencyMs: result.totalLatencyMs,
      error: message,
    });
    return result;
  };

  try {
    // 1. Locate the statements. Plain code, traced like any agent step so
    //    the run view shows what the extractors were given and why.
    const locateStart = Date.now();
    const { documents, exhibitUrls } = await loadFilingDocuments(
      ticker,
      filing,
    );
    const { tables } = parseFiling(documents);
    const located: Partial<Record<StatementKind, FilingTable>> = {};
    const locatorOutput: Record<string, unknown> = {};
    for (const kind of KINDS) {
      const hit = locateStatement(tables, kind);
      if (!hit) continue;
      located[kind] = hit.table;
      locatorOutput[kind] = {
        tableIndex: hit.table.index,
        rows: hit.table.rows.length,
        heading: hit.table.heading.slice(-120),
        score: hit.candidate.score,
        runnerUpScore: hit.runnerUp?.score ?? null,
        scale: detectScale(hit.table),
      };
    }
    const locatorIndex = events.length;
    await record(
      stepEvent(
        "locator",
        null,
        {
          documents: 1 + exhibitUrls.length,
          exhibits: exhibitUrls,
          tables: tables.length,
        },
        {
          output: locatorOutput,
          toolCalls: [],
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          latencyMs: Date.now() - locateStart,
        },
      ),
    );
    const missing = KINDS.filter((k) => !located[k]);
    if (missing.length === KINDS.length) {
      return fail("No financial statements could be located in this filing.");
    }

    // 2. Extract all three statements in parallel.
    const extract = async (kind: StatementKind, hint?: string) => {
      const table = located[kind]!;
      try {
        const step = await runExtraction(kind, table, filing.reportDate, hint);
        await record(
          stepEvent(
            AGENT_NAME[kind],
            locatorIndex,
            {
              tableIndex: table.index,
              rows: table.rows.length,
              retryHint: hint ?? null,
            },
            step,
          ),
        );
        return step.output;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await record(
          stepEvent(
            AGENT_NAME[kind],
            locatorIndex,
            { tableIndex: table.index, retryHint: hint ?? null },
            {
              output: null,
              toolCalls: [],
              tokensIn: 0,
              tokensOut: 0,
              costUsd: 0,
              latencyMs: 0,
            },
            message,
          ),
        );
        return null;
      }
    };

    const extractions: Partial<Record<StatementKind, StatementExtraction>> = {};
    const present = KINDS.filter((k) => located[k]);
    const firstPass = await Promise.all(present.map((k) => extract(k)));
    present.forEach((k, i) => {
      if (firstPass[i]) extractions[k] = firstPass[i]!;
    });

    // 3. Reconcile, and retry once, only the statements a trusted check
    //    implicates, telling the agent exactly which check failed.
    const runChecks = async (): Promise<ReconciliationCheck[]> => {
      const t0 = Date.now();
      const checks = reconcile(
        Object.fromEntries(
          KINDS.filter((k) => extractions[k] && located[k]).map((k) => [
            k,
            { table: located[k]!, extraction: extractions[k]! },
          ]),
        ),
      );
      await record(
        stepEvent("reconciler", locatorIndex, null, {
          output: checks,
          toolCalls: [],
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          latencyMs: Date.now() - t0,
        }),
      );
      return checks;
    };

    let checks = await runChecks();
    let retryCount = 0;
    while (retryCount < MAX_RETRIES) {
      const failing = checks.filter(
        (c) => !c.passed && !c.skipped && RETRYABLE_CHECKS.has(c.name),
      );
      if (failing.length === 0) break;
      retryCount++;
      const byStatement = new Map<StatementKind, string[]>();
      for (const c of failing) {
        byStatement.set(c.statement, [
          ...(byStatement.get(c.statement) ?? []),
          c.detail,
        ]);
      }
      const retried = await Promise.all(
        [...byStatement.entries()].map(
          async ([kind, details]) =>
            [kind, await extract(kind, details.join(" "))] as const,
        ),
      );
      for (const [kind, out] of retried) if (out) extractions[kind] = out;
      checks = await runChecks();
    }

    const statements = KINDS.map((k) => extractions[k]).filter(
      (e): e is StatementExtraction => !!e,
    );
    const figures = statements.flatMap((s) => s.figures);
    const scored = checks.filter((c) => !c.skipped);
    const result: AnalysisResult = {
      runId,
      accessionNumber: filing.accessionNumber,
      status: statements.length > 0 ? "completed" : "failed",
      figures,
      statements,
      checks,
      retryCount,
      totalCostUsd: totalCost,
      totalLatencyMs: Date.now() - started,
      events,
      error: statements.length > 0 ? null : "every extraction agent failed",
    };
    await finalizeRun(runId, {
      status: result.status,
      result: { figures, statements, checks },
      checksPassed: scored.filter((c) => c.passed).length,
      checksTotal: scored.length,
      retryCount,
      totalCostUsd: totalCost,
      totalLatencyMs: result.totalLatencyMs,
      error: result.error,
    });
    return result;
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}
