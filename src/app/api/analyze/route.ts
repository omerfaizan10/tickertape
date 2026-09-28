import { getPool } from "@/lib/db";
import { isMockMode } from "@/lib/llm/client";
import { analyzeFiling } from "@/lib/agent/orchestrator";
import { listFilings, lookupTicker } from "@/lib/sec/client";

export const runtime = "nodejs";
// A live analysis with the prior-year check reads two 10-Ks and runs up to
// eight agent steps: typically 10 to 20 seconds, so a minute of headroom.
export const maxDuration = 60;

// Each live analysis is three model calls plus up to three SEC downloads,
// and checking last year's 10-K doubles that, so a public page needs a hard
// ceiling. 30 runs an hour keeps worst-case model spend at a few cents an
// hour and SEC traffic far under its limits.
const MAX_LIVE_PER_HOUR = 30;

async function withinRateLimit(): Promise<boolean> {
  const { rows } = await getPool().query(
    `select count(*)::int as n
     from runs r join filings f on f.accession_number = r.accession_number
     where f.source = 'live' and r.started_at > now() - interval '1 hour'`,
  );
  return rows[0].n < MAX_LIVE_PER_HOUR;
}

export async function POST(request: Request) {
  if (isMockMode()) {
    return Response.json(
      {
        error:
          "This environment is running in mock mode (MOCK_LLM=true), where rows are picked by label patterns instead of a model. Live analysis needs a real OPENAI_API_KEY.",
      },
      { status: 409 },
    );
  }

  let body: { ticker?: unknown; priorYear?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const ticker =
    typeof body.ticker === "string" ? body.ticker.trim().toUpperCase() : "";
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) {
    return Response.json(
      { error: "Enter a stock ticker, like AAPL." },
      { status: 400 },
    );
  }

  const company = await lookupTicker(ticker);
  if (!company) {
    return Response.json(
      { error: `${ticker} isn't in the SEC's list of company tickers.` },
      { status: 404 },
    );
  }
  const [filing] = await listFilings(company.cik, "10-K", 1);
  if (!filing) {
    return Response.json(
      {
        error: `${company.name} has no 10-K on file with the SEC. Foreign companies file a 20-F instead, and a newly registered company may not have filed one yet.`,
      },
      { status: 404 },
    );
  }

  if (!(await withinRateLimit())) {
    return Response.json(
      {
        error: `Live analysis is limited to ${MAX_LIVE_PER_HOUR} filing reads an hour to keep costs bounded. Try again later, or browse the golden set runs.`,
      },
      { status: 429 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      send({
        type: "filing",
        filing: { ticker, ...filing },
      });
      try {
        const result = await analyzeFiling(ticker, filing, {
          source: "live",
          onEvent: (event) => send({ type: "event", event }),
          priorYear: body.priorYear !== false,
          narrative: true,
        });
        send({ type: "done", result: { ...result, events: undefined } });
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
