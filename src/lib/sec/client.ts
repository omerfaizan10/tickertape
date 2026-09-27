// Thin client for SEC EDGAR. Two rules from sec.gov shape everything here:
// every request must identify who is making it (User-Agent with contact
// info - unidentified bots are refused), and no more than 10 requests per
// second in total. The throttle stays under that with margin, and it is
// process-wide, so parallel agents can't add up to a burst.

const MIN_INTERVAL_MS = 125; // 8 req/s, under SEC's 10 req/s ceiling
const MAX_ATTEMPTS = 4;

let nextSlot = 0;

async function throttle(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_INTERVAL_MS;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

function userAgent(): string {
  const ua = process.env.SEC_USER_AGENT;
  if (!ua) {
    throw new Error(
      "SEC_USER_AGENT is not set. SEC requires a name and contact email on every request - add it to .env.local (see env.example).",
    );
  }
  return ua;
}

async function secFetch(url: string): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    await throttle();
    const res = await fetch(url, {
      headers: {
        "User-Agent": userAgent(),
        "Accept-Encoding": "gzip, deflate",
      },
    });
    if (res.ok) return res;
    // 429 and 503 are SEC saying slow down; anything else is a real error.
    const retryable = res.status === 429 || res.status === 503;
    if (!retryable || attempt >= MAX_ATTEMPTS) {
      throw new Error(`SEC request failed (${res.status}): ${url}`);
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
}

export async function secJson<T>(url: string): Promise<T> {
  return (await secFetch(url)).json() as Promise<T>;
}

export async function secText(url: string): Promise<string> {
  return (await secFetch(url)).text();
}

export function padCik(cik: number | string): string {
  return String(cik).padStart(10, "0");
}

interface TickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
}

export async function lookupTicker(
  ticker: string,
): Promise<{ cik: number; name: string } | null> {
  const all = await secJson<Record<string, TickerEntry>>(
    "https://www.sec.gov/files/company_tickers.json",
  );
  const match = Object.values(all).find(
    (e) => e.ticker.toUpperCase() === ticker.toUpperCase(),
  );
  return match ? { cik: match.cik_str, name: match.title } : null;
}

export interface FilingRef {
  cik: number;
  companyName: string;
  accessionNumber: string;
  form: string;
  filingDate: string;
  reportDate: string;
  primaryDocument: string;
  url: string;
}

interface SubmissionsResponse {
  name: string;
  filings: {
    recent: {
      accessionNumber: string[];
      form: string[];
      filingDate: string[];
      reportDate: string[];
      primaryDocument: string[];
    };
  };
}

// Most recent filings of a given form, newest first. Amendments (10-K/A)
// are excluded on purpose: they often restate only part of a report, so
// they aren't a fair full document to extract from.
export async function listFilings(
  cik: number,
  form = "10-K",
  limit = 5,
): Promise<FilingRef[]> {
  const sub = await secJson<SubmissionsResponse>(
    `https://data.sec.gov/submissions/CIK${padCik(cik)}.json`,
  );
  const r = sub.filings.recent;
  const out: FilingRef[] = [];
  for (let i = 0; i < r.form.length && out.length < limit; i++) {
    if (r.form[i] !== form) continue;
    const accn = r.accessionNumber[i];
    out.push({
      cik,
      companyName: sub.name,
      accessionNumber: accn,
      form: r.form[i],
      filingDate: r.filingDate[i],
      reportDate: r.reportDate[i],
      primaryDocument: r.primaryDocument[i],
      url: `https://www.sec.gov/Archives/edgar/data/${cik}/${accn.replace(/-/g, "")}/${r.primaryDocument[i]}`,
    });
  }
  return out;
}

export async function fetchFilingHtml(filing: FilingRef): Promise<string> {
  return secText(filing.url);
}
