"use client";

import { useState } from "react";
import Link from "next/link";
import { FiguresTable } from "@/components/figures-table";
import { ChecksList } from "@/components/checks-list";
import type { AnalysisResult, TraceEvent } from "@/lib/agent/types";

const SUGGESTIONS = ["AAPL", "NVDA", "JPM", "KO", "TSLA", "COST"];

// The pipeline's steps, in the order they report in, so the live view can
// show what's pending before anything has finished.
const STEPS: { agent: string; label: string; detail: string }[] = [
  {
    agent: "locator",
    label: "locate statements",
    detail: "parse the filing, find the three statements (code)",
  },
  {
    agent: "income_extractor",
    label: "income statement agent",
    detail: "picks the row for each income figure",
  },
  {
    agent: "balance_extractor",
    label: "balance sheet agent",
    detail: "picks the row for each balance sheet figure",
  },
  {
    agent: "cashflow_extractor",
    label: "cash flow agent",
    detail: "picks the row for each cash flow figure",
  },
  {
    agent: "reconciler",
    label: "reconcile",
    detail: "checks the picks against the statements' own totals (code)",
  },
];

interface FilingInfo {
  ticker: string;
  companyName: string;
  reportDate: string;
  filingDate: string;
  url: string;
}

type DoneResult = Omit<AnalysisResult, "events">;

export function AnalyzeForm() {
  const [ticker, setTicker] = useState("");
  const [running, setRunning] = useState(false);
  const [filing, setFiling] = useState<FilingInfo | null>(null);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [result, setResult] = useState<DoneResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function analyze(t: string) {
    const symbol = t.trim().toUpperCase();
    if (!symbol || running) return;
    setTicker(symbol);
    setRunning(true);
    setFiling(null);
    setEvents([]);
    setResult(null);
    setError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: symbol }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? `Request failed (${res.status}).`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line);
          if (msg.type === "filing") setFiling(msg.filing);
          else if (msg.type === "event") setEvents((p) => [...p, msg.event]);
          else if (msg.type === "done") setResult(msg.result);
          else if (msg.type === "error") setError(msg.message);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  const retries = events.filter(
    (e) =>
      e.agentName.endsWith("_extractor") &&
      (e.input as { retryHint?: string | null } | null)?.retryHint,
  );

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void analyze(ticker);
        }}
        className="rounded-lg border border-border bg-surface p-4"
      >
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            disabled={running}
            placeholder="AAPL"
            maxLength={10}
            className="w-32 rounded border border-border-soft bg-bg/40 px-3 py-1.5 font-mono text-sm text-text uppercase placeholder:text-text-faint focus:border-accent focus:outline-none"
            aria-label="ticker"
          />
          <button
            type="submit"
            disabled={running || !ticker.trim()}
            className="rounded border border-accent/40 bg-accent-soft px-4 py-1.5 text-sm text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? "analyzing..." : "analyze latest 10-K"}
          </button>
          <span className="text-xs text-text-faint">or try</span>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={running}
              onClick={() => void analyze(s)}
              className="rounded border border-border px-2 py-1 font-mono text-xs text-text-muted transition-colors hover:border-accent hover:text-text disabled:opacity-40"
            >
              {s}
            </button>
          ))}
        </div>
        {error ? (
          <div className="mt-3 rounded border border-escalate/30 bg-escalate-soft px-3 py-2 text-sm text-escalate">
            {error}
          </div>
        ) : null}
      </form>

      {filing ? (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="font-mono text-accent">{filing.ticker}</span>
          <span className="text-text">{filing.companyName}</span>
          <span className="font-mono text-xs text-text-muted">
            10-K for period ending {filing.reportDate}, filed{" "}
            {filing.filingDate}
          </span>
          <a
            href={filing.url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-accent hover:underline"
          >
            filing on sec.gov ↗
          </a>
        </div>
      ) : null}

      {filing ? (
        <ol className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
          {STEPS.map((step) => {
            const hits = events.filter((e) => e.agentName === step.agent);
            const last = hits[hits.length - 1];
            const state = last
              ? last.error
                ? "error"
                : "done"
              : running
                ? "pending"
                : "idle";
            return (
              <li key={step.agent} className="flex items-baseline gap-3 text-sm">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    state === "done"
                      ? "bg-approve"
                      : state === "error"
                        ? "bg-escalate"
                        : state === "pending"
                          ? "animate-pulse bg-accent"
                          : "bg-text-faint"
                  }`}
                />
                <span className="w-48 shrink-0 text-text">{step.label}</span>
                <span className="text-xs text-text-faint">
                  {last?.error
                    ? last.error
                    : last
                      ? `${(last.latencyMs / 1000).toFixed(1)}s${last.costUsd > 0 ? ` · $${last.costUsd.toFixed(4)}` : ""}${hits.length > 1 ? ` · ran ${hits.length}x` : ""}`
                      : step.detail}
                </span>
              </li>
            );
          })}
          {retries.length > 0 ? (
            <li className="pl-5 text-xs text-review">
              {retries.length} agent{retries.length > 1 ? "s" : ""} re-ran after
              a failed check:{" "}
              {retries
                .map(
                  (r) =>
                    (r.input as { retryHint?: string }).retryHint?.slice(0, 140) ??
                    "",
                )
                .join(" | ")}
            </li>
          ) : null}
        </ol>
      ) : null}

      {result && result.status === "completed" ? (
        <>
          <section>
            <div className="mb-3 flex flex-wrap items-baseline gap-3">
              <h2 className="text-xs uppercase tracking-wide text-text-faint">
                figures
              </h2>
              <span className="font-mono text-xs text-text-faint">
                ${result.totalCostUsd.toFixed(4)} ·{" "}
                {(result.totalLatencyMs / 1000).toFixed(1)}s
              </span>
              <Link
                href={`/runs/${result.runId}`}
                className="text-xs text-accent hover:underline"
              >
                full run with statements →
              </Link>
            </div>
            <FiguresTable figures={result.figures} />
          </section>
          <section>
            <h2 className="mb-3 text-xs uppercase tracking-wide text-text-faint">
              checks
            </h2>
            <ChecksList checks={result.checks} />
          </section>
        </>
      ) : result?.error ? (
        <div className="rounded border border-escalate/30 bg-escalate-soft px-3 py-2 text-sm text-escalate">
          {result.error}
        </div>
      ) : null}
    </div>
  );
}
