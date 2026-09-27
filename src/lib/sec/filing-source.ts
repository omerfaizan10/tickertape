import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  fetchFilingHtml,
  listAnnualReportExhibits,
  secText,
  type FilingRef,
} from "./client";

// Every document that makes up a 10-K's financial statements: the 10-K
// itself plus any Exhibit 13 annual report they're incorporated from.
//
// Downloads are cached on disk when the disk is writable (local runs, the
// eval), so re-running the golden set doesn't re-fetch 54 filings from the
// SEC. Where it isn't (a serverless deploy), everything is fetched fresh.

const CACHE_DIR = join(process.cwd(), "data", "cache");

function readCache(file: string): string | null {
  const path = join(CACHE_DIR, file);
  return existsSync(path) ? readFileSync(path, "utf-8") : null;
}

function writeCache(file: string, data: string): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(join(CACHE_DIR, file), data);
  } catch {
    // Read-only filesystem: caching is an optimization, not a requirement.
  }
}

export async function cachedText(
  file: string,
  fetcher: () => Promise<string>,
): Promise<string> {
  const hit = readCache(file);
  if (hit !== null) return hit;
  const data = await fetcher();
  writeCache(file, data);
  return data;
}

export async function cachedJson<T>(
  file: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  const hit = readCache(file);
  if (hit !== null) return JSON.parse(hit) as T;
  const data = await fetcher();
  writeCache(file, JSON.stringify(data));
  return data;
}

export async function loadFilingDocuments(
  ticker: string,
  filing: FilingRef,
): Promise<{ documents: string[]; exhibitUrls: string[] }> {
  const main = await cachedText(
    `${ticker}-${filing.accessionNumber}.html`,
    () => fetchFilingHtml(filing),
  );
  const exhibits = await cachedJson(
    `exhibits-${filing.accessionNumber}.json`,
    () => listAnnualReportExhibits(filing),
  );
  const exhibitHtml = await Promise.all(
    exhibits.map((doc) =>
      cachedText(`${ticker}-${filing.accessionNumber}-${doc.name}`, () =>
        secText(doc.url),
      ),
    ),
  );
  return {
    documents: [main, ...exhibitHtml],
    exhibitUrls: exhibits.map((d) => d.url),
  };
}
