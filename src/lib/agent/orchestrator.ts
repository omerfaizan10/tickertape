import { isMockMode, MODEL_LABEL } from "../llm/client";
import { listFilings, type FilingRef } from "../sec/client";
import { parseFiling, type FilingTable } from "../sec/filing-text";
import { loadFilingDocuments } from "../sec/filing-source";
import { locateStatement, type StatementKind } from "../sec/locate-statements";
import { detectScale, parseAmount } from "../sec/units";
import { AGENT_NAME, runExtraction } from "./extract";
import { PROMPT_VERSION } from "./prompts";
import { reconcile, RETRYABLE_CHECKS } from "./reconcile";
import { createRun, finalizeRun, upsertFiling, writeTraceEvent } from "./trace";
import { compareWithPriorFiling } from "../revisions";
import { explainRevisions } from "./explain-revisions";
import { checkNarrative, type NarrativeClaim } from "./narrative";
import type {
  AgentStepResult,
  AnalysisResult,
  PriorYearCheck,
  ReconciliationCheck,
  StatementExtraction,
  TraceEvent,
} from "./types";

// The pipeline for one 10-K:
//
//   locator (code)  ->  income / balance / cash flow extractors (parallel)
//                   ->  reconciler (code)  ->  targeted retry (once)
//                   ->  optionally: last year's 10-K as its own run,
//                       restatement check (code), explainer (agent)
//
// Only the extractors and the explainer call a model. Finding the statements, reading the
// cell, applying units and checking the results are all code, so every
// figure is traceable to a printed cell and every check is reproducible.

const KINDS: StatementKind[] = ["income", "balance", "cashflow"];
const MAX_RETRIES = 1;

export interface RunOptions {
  source?: "golden_set" | "live";
  onEvent?: (event: TraceEvent) => void;
  // Also read last year's 10-K and compare: which of last year's figures
  // does this filing reprint differently from how they were first
  // reported? Pass the prior filing to skip looking it up.
  priorYear?: boolean | FilingRef;
  // Check management's year-over-year claims (MD&A) against the figures.
  narrative?: boolean;
}

export async function analyzeFiling(
  ticker: string,
  filing: FilingRef,
  options: RunOptions = {},
): Promise<AnalysisResult> {
  const started = Date.now();
  const model = isMockMode() ? "mock" : MODEL_LABEL;
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
      priorYear: null,
      narrative: null,
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
    const { tables, paragraphs } = parseFiling(documents);
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
    for (const c of checks) {
      if (c.passed || c.skipped || !RETRYABLE_CHECKS.has(c.name)) continue;
      for (const f of figures) {
        if (c.fields.includes(f.field)) f.failedChecks.push(c.name);
      }
    }

    // 4. Optionally, last year's 10-K: its own full run, then a code
    //    comparison, then an explainer only if something was revised.
    const narrativeStep = async (): Promise<NarrativeClaim[] | null> => {
      if (!options.narrative || statements.length === 0) return null;
      try {
        const step = await checkNarrative(
          paragraphs,
          figures,
          Object.fromEntries(
            statements
              .filter((x) => located[x.statement])
              .map((x) => [
                x.statement,
                {
                  table: located[x.statement]!,
                  current: x.currentColumn,
                  prior: x.priorColumn,
                },
              ]),
          ),
          filing.reportDate,
          printedFigures(
            tables.filter(
              (t) => !Object.values(located).some((l) => l?.index === t.index),
            ),
          ),
        );
        await record(
          stepEvent("narrative_checker", locatorIndex, null, step),
        );
        return step.output;
      } catch (err) {
        await record(
          stepEvent(
            "narrative_checker",
            locatorIndex,
            null,
            { output: null, toolCalls: [], tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0 },
            err instanceof Error ? err.message : String(err),
          ),
        );
        return null;
      }
    };
    const narrativePromise = narrativeStep();

    let priorYear: PriorYearCheck | null = null;
    if (options.priorYear && statements.length > 0) {
      priorYear = await checkPriorYear(
        ticker,
        filing,
        options.priorYear === true ? null : options.priorYear,
        figures,
        paragraphs,
        {
          source: options.source,
          record,
          stepEvent,
          locatorIndex,
          currentTables: located,
          currentStatements: statements,
        },
      );
    }
    const scored = checks.filter((c) => !c.skipped);
    const result: AnalysisResult = {
      runId,
      accessionNumber: filing.accessionNumber,
      status: statements.length > 0 ? "completed" : "failed",
      figures,
      statements,
      checks,
      priorYear,
      narrative: await narrativePromise,
      retryCount,
      totalCostUsd: totalCost,
      totalLatencyMs: Date.now() - started,
      events,
      error: statements.length > 0 ? null : "every extraction agent failed",
    };
    await finalizeRun(runId, {
      status: result.status,
      result: {
        figures,
        statements,
        checks,
        priorYear,
        narrative: result.narrative,
      },
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

// Every figure printed in the given tables, scaled to dollars, for the
// narrative check to recognize segment and supplemental figures.
function printedFigures(tables: FilingTable[]): Set<number> {
  const out = new Set<number>();
  for (const t of tables) {
    const scale = detectScale(t);
    for (const row of t.rows) {
      for (const cell of row.slice(1)) {
        const n = parseAmount(cell);
        if (n !== null && Math.abs(n) >= 1) out.add(n * scale);
      }
    }
  }
  return out;
}

type StepEventFn = <T>(
  agentName: string,
  parentStepIndex: number | null,
  input: unknown,
  step: Omit<AgentStepResult<T>, "output"> & { output: unknown },
  error?: string | null,
) => TraceEvent;

async function checkPriorYear(
  ticker: string,
  filing: FilingRef,
  given: FilingRef | null,
  figures: AnalysisResult["figures"],
  paragraphs: string[],
  ctx: {
    source?: "golden_set" | "live";
    record: (e: TraceEvent) => Promise<void>;
    stepEvent: StepEventFn;
    locatorIndex: number;
    currentTables: Partial<Record<StatementKind, FilingTable>>;
    currentStatements: StatementExtraction[];
  },
): Promise<PriorYearCheck | null> {
  const t0 = Date.now();
  const prior =
    given ??
    (await listFilings(filing.cik, "10-K", 2)).find(
      (f) =>
        f.accessionNumber !== filing.accessionNumber &&
        f.reportDate < filing.reportDate,
    ) ??
    null;
  if (!prior) return null;

  // Last year's filing is analyzed exactly like this one, as its own run,
  // so its figures carry the same provenance and checks.
  const priorRun = await analyzeFiling(ticker, prior, { source: ctx.source });
  if (priorRun.status !== "completed") return null;

  // Both years' statements, to line up rows by label where the agents
  // picked different lines in the two filings.
  const { documents: priorDocs } = await loadFilingDocuments(ticker, prior);
  const { tables: priorTables } = parseFiling(priorDocs);
  const statementsFor = (
    tables: Partial<Record<StatementKind, FilingTable>>,
    extractions: StatementExtraction[],
  ) =>
    Object.fromEntries(
      extractions
        .filter((x) => tables[x.statement])
        .map((x) => [x.statement, { table: tables[x.statement]!, column: x.currentColumn }]),
    );
  const priorLocated: Partial<Record<StatementKind, FilingTable>> = {};
  for (const x of priorRun.statements) {
    const hit = locateStatement(priorTables, x.statement);
    if (hit) priorLocated[x.statement] = hit.table;
  }
  const revisions = compareWithPriorFiling(figures, priorRun.figures, {
    current: statementsFor(ctx.currentTables, ctx.currentStatements),
    prior: statementsFor(priorLocated, priorRun.statements),
  });
  const compare = ctx.stepEvent(
    "restatement_check",
    ctx.locatorIndex,
    {
      priorRunId: priorRun.runId,
      priorAccessionNumber: prior.accessionNumber,
      priorPeriodEnd: prior.reportDate,
    },
    {
      output: revisions,
      toolCalls: [],
      tokensIn: 0,
      tokensOut: 0,
      costUsd: priorRun.totalCostUsd,
      latencyMs: Date.now() - t0,
    },
  );
  await ctx.record(compare);

  let explanations: PriorYearCheck["explanations"] = [];
  if (revisions.some((r) => r.revised)) {
    try {
      const step = await explainRevisions(revisions, paragraphs);
      await ctx.record(
        ctx.stepEvent(
          "revision_explainer",
          compare.stepIndex,
          { revised: revisions.filter((r) => r.revised).map((r) => r.field) },
          step,
        ),
      );
      explanations = step.output;
    } catch (err) {
      await ctx.record(
        ctx.stepEvent(
          "revision_explainer",
          compare.stepIndex,
          null,
          { output: null, toolCalls: [], tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0 },
          err instanceof Error ? err.message : String(err),
        ),
      );
    }
  }

  return {
    priorRunId: priorRun.runId,
    priorAccessionNumber: prior.accessionNumber,
    priorPeriodEnd: prior.reportDate,
    revisions,
    explanations,
  };
}
