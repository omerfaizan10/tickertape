import { config } from "dotenv";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  fetchFilingHtml,
  listAnnualReportExhibits,
  secText,
  listFilings,
  lookupTicker,
  padCik,
  secJson,
} from "../src/lib/sec/client";
import { parseFiling, type FilingTable } from "../src/lib/sec/filing-text";
import {
  locateStatement,
  type StatementKind,
} from "../src/lib/sec/locate-statements";
import { detectScale } from "../src/lib/sec/units";
import { FIELDS } from "../src/lib/fields";
import {
  buildAnswerKey,
  type CompanyFacts,
} from "../src/lib/eval/answer-key";
import type { GoldenFiling } from "../src/lib/golden";

config({ path: ".env.local", quiet: true });

// A spread of large US filers across sectors, so the eval covers the
// statement layouts that actually differ: banks (no operating income, no
// "revenue" line in the usual sense), insurers, utilities, retailers with
// January year-ends, and tech with September year-ends.
const COMPANIES: [string, string][] = [
  ["AAPL", "Technology"],
  ["MSFT", "Technology"],
  ["GOOGL", "Technology"],
  ["NVDA", "Technology"],
  ["ORCL", "Technology"],
  ["ADBE", "Technology"],
  ["CSCO", "Technology"],
  ["INTC", "Technology"],
  ["IBM", "Technology"],
  ["CRM", "Technology"],
  ["JPM", "Financials"],
  ["BAC", "Financials"],
  ["WFC", "Financials"],
  ["GS", "Financials"],
  ["MS", "Financials"],
  ["C", "Financials"],
  ["AXP", "Financials"],
  ["BLK", "Financials"],
  ["SCHW", "Financials"],
  ["USB", "Financials"],
  ["JNJ", "Healthcare"],
  ["PFE", "Healthcare"],
  ["MRK", "Healthcare"],
  ["ABBV", "Healthcare"],
  ["UNH", "Healthcare"],
  ["LLY", "Healthcare"],
  ["AMGN", "Healthcare"],
  ["CVS", "Healthcare"],
  ["BMY", "Healthcare"],
  ["TMO", "Healthcare"],
  ["WMT", "Consumer"],
  ["KO", "Consumer"],
  ["PEP", "Consumer"],
  ["PG", "Consumer"],
  ["MCD", "Consumer"],
  ["NKE", "Consumer"],
  ["COST", "Consumer"],
  ["HD", "Consumer"],
  ["TGT", "Consumer"],
  ["SBUX", "Consumer"],
  ["CVX", "Energy"],
  ["COP", "Energy"],
  ["GE", "Industrials"],
  ["CAT", "Industrials"],
  ["BA", "Industrials"],
  ["HON", "Industrials"],
  ["UPS", "Industrials"],
  ["LMT", "Industrials"],
  ["DE", "Industrials"],
  ["MMM", "Industrials"],
  ["VZ", "Telecom & Utilities"],
  ["T", "Telecom & Utilities"],
  ["NEE", "Telecom & Utilities"],
  ["DUK", "Telecom & Utilities"],
];

const CACHE = join(process.cwd(), "data", "cache");
const OUT = join(process.cwd(), "data", "golden", "golden-set.json");

async function cached<T>(
  file: string,
  fetcher: () => Promise<T>,
  asJson: boolean,
): Promise<T> {
  const path = join(CACHE, file);
  if (existsSync(path)) {
    const raw = readFileSync(path, "utf-8");
    return (asJson ? JSON.parse(raw) : raw) as T;
  }
  const data = await fetcher();
  writeFileSync(path, asJson ? JSON.stringify(data) : (data as string));
  return data;
}

const KINDS: StatementKind[] = ["income", "balance", "cashflow"];

async function buildOne(
  ticker: string,
  sector: string,
): Promise<GoldenFiling | { ticker: string; skipped: string }> {
  const co = await lookupTicker(ticker);
  if (!co) return { ticker, skipped: "ticker not in SEC's ticker map" };
  const [filing] = await listFilings(co.cik, "10-K", 1);
  if (!filing) {
    return { ticker, skipped: `${co.name} has no 10-K on file` };
  }

  const html = await cached(
    `${ticker}-${filing.accessionNumber}.html`,
    () => fetchFilingHtml(filing),
    false,
  );
  const facts = await cached<CompanyFacts>(
    `facts-${padCik(co.cik)}-${filing.accessionNumber}.json`,
    () =>
      secJson(
        `https://data.sec.gov/api/xbrl/companyfacts/CIK${padCik(co.cik)}.json`,
      ),
    true,
  );

  const exhibits = await cached(
    `exhibits-${filing.accessionNumber}.json`,
    () => listAnnualReportExhibits(filing),
    true,
  );
  const exhibitHtml = await Promise.all(
    exhibits.map((doc) =>
      cached(
        `${ticker}-${filing.accessionNumber}-${doc.name}`,
        () => secText(doc.url),
        false,
      ),
    ),
  );

  const { tables } = parseFiling([html, ...exhibitHtml]);
  const statements: GoldenFiling["statements"] = {};
  const statementTables: Partial<Record<StatementKind, FilingTable>> = {};
  for (const kind of KINDS) {
    const located = locateStatement(tables, kind);
    if (!located) continue;
    const { table, candidate, runnerUp } = located;
    statements[kind] = {
      tableIndex: table.index,
      score: Math.round(candidate.score * 10) / 10,
      runnerUpScore: runnerUp ? Math.round(runnerUp.score * 10) / 10 : null,
      scale: detectScale(table),
    };
    statementTables[kind] = table;
  }

  return {
    ticker,
    sector,
    cik: co.cik,
    companyName: filing.companyName,
    accessionNumber: filing.accessionNumber,
    periodEnd: filing.reportDate,
    filingDate: filing.filingDate,
    url: filing.url,
    exhibits: exhibits.map((d) => d.url),
    statements,
    answerKey: buildAnswerKey(
      facts,
      FIELDS,
      statementTables,
      filing.accessionNumber,
      filing.reportDate,
    ),
  };
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  mkdirSync(join(process.cwd(), "data", "golden"), { recursive: true });

  const filings: GoldenFiling[] = [];
  const skipped: { ticker: string; skipped: string }[] = [];

  for (const [ticker, sector] of COMPANIES) {
    try {
      const result = await buildOne(ticker, sector);
      if ("skipped" in result) {
        skipped.push(result);
        console.log(`skip ${ticker}: ${result.skipped}`);
        continue;
      }
      filings.push(result);
      const entries = Object.values(result.answerKey);
      const scored = entries.filter((e) => e.onStatement).length;
      const missing = KINDS.filter((k) => !result.statements[k]);
      console.log(
        `ok   ${ticker.padEnd(5)} ${result.periodEnd}  key ${scored}/${entries.length} on statement` +
          (result.exhibits.length ? `  (+${result.exhibits.length} EX-13)` : "") +
          (missing.length ? `  NO ${missing.join("/")} located` : ""),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      skipped.push({ ticker, skipped: msg });
      console.log(`fail ${ticker}: ${msg}`);
    }
  }

  writeFileSync(
    OUT,
    JSON.stringify(
      { builtAt: new Date().toISOString(), filings, skipped },
      null,
      2,
    ) + "\n",
  );

  const all = filings.flatMap((f) => Object.values(f.answerKey));
  const onStatement = all.filter((e) => e.onStatement).length;
  console.log(
    `\n${filings.length} filings, ${skipped.length} skipped. ` +
      `Answer key: ${all.length} figures from XBRL, ${onStatement} found on the located statement (${((onStatement / all.length) * 100).toFixed(1)}%).`,
  );
  for (const spec of FIELDS) {
    const entries = filings
      .map((f) => f.answerKey[spec.key])
      .filter((e) => e !== undefined);
    const on = entries.filter((e) => e.onStatement).length;
    console.log(
      `  ${spec.key.padEnd(18)} in XBRL for ${String(entries.length).padStart(2)}/${filings.length}, on statement ${String(on).padStart(2)}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
