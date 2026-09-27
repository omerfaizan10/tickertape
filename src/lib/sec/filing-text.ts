import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

// Turns a 10-K's HTML into plain tables and text that agents can read.
//
// The important part is what this throws away. Modern 10-Ks are inline
// XBRL: the same HTML carries machine-readable tags (ix:nonFraction
// name="us-gaap:Assets" ...) plus a hidden ix:header block of extra facts.
// Those tags are the SEC's structured data, which is exactly what the eval
// grades against. An agent that could see them would be reading the answer
// key, so only the visible text survives this step - no tag names, no
// attributes, no hidden elements.

export interface FilingTable {
  index: number;
  // The nearest text above the table, which is where a statement's title
  // ("CONSOLIDATED BALANCE SHEETS") sits.
  heading: string;
  rows: string[][];
}

export interface ParsedFiling {
  tables: FilingTable[];
}

const HEADING_LOOKBACK_CHARS = 300;

function clean(s: string): string {
  return s.replace(/\u00a0/g, " ").replace(/[\u2014\u2013]/g, "-").replace(/\s+/g, " ").trim();
}

// Financial tables split one number across several cells: "$" in one,
// "1,234" in the next, ")" in a third. Rejoin those so each value is one
// cell, and drop the empty spacer cells layout tables are full of.
function mergeCells(cells: string[]): string[] {
  const out: string[] = [];
  for (const raw of cells) {
    const c = clean(raw);
    if (!c) continue;
    const prev = out.length - 1;
    if (
      prev >= 0 &&
      (out[prev] === "$" || out[prev] === "(" || out[prev] === "$(")
    ) {
      out[prev] = out[prev] + c;
    } else if (prev >= 0 && (c === ")" || c === "%" || c === ")%")) {
      out[prev] = out[prev] + c;
    } else {
      out.push(c);
    }
  }
  return out.map((c) => c.replace(/^\$\s*/, "").replace(/^\(\$/, "("));
}

export function parseFiling(html: string): ParsedFiling {
  const $ = cheerio.load(html);

  $("ix\\:header, script, style").remove();
  $("[style]").each((_, el) => {
    const style = ($(el).attr("style") ?? "").replace(/\s/g, "").toLowerCase();
    if (style.includes("display:none")) $(el).remove();
  });

  // Walk the document in order, keeping a rolling window of the text seen
  // so far, so each table can be labeled with whatever came right before it.
  const tables: FilingTable[] = [];
  let recentText = "";

  const visit = (node: AnyNode) => {
    if (node.type === "text") {
      const t = clean(node.data);
      if (t) recentText = (recentText + " " + t).slice(-HEADING_LOOKBACK_CHARS);
      return;
    }
    if (node.type !== "tag") return;
    if (node.name === "table") {
      const rows: string[][] = [];
      $(node)
        .find("tr")
        .each((_, tr) => {
          const cells = mergeCells(
            $(tr)
              .find("td, th")
              .map((__, td) => $(td).text())
              .get(),
          );
          if (cells.length > 0) rows.push(cells);
        });
      if (rows.length > 0) {
        tables.push({ index: tables.length, heading: clean(recentText), rows });
      }
      // Some filers (Chevron, for one) put a statement's title in its own
      // tiny table right above the numbers. A small table with no figures
      // in it is a title block, so it becomes the next table's heading
      // instead of being forgotten.
      const isTitleBlock =
        rows.length > 0 &&
        rows.length <= 3 &&
        !rows.flat().some((c) => /\d{2,}/.test(c.replace(/^\d{1,3}$/, "")));
      recentText = isTitleBlock
        ? rows.flat().join(" ").slice(-HEADING_LOOKBACK_CHARS)
        : "";
      return;
    }
    for (const child of node.children) visit(child);
  };

  const root = $.root()[0];
  for (const child of root.children) visit(child);

  return { tables };
}

export function tableToText(table: FilingTable): string {
  return table.rows.map((r) => r.join(" | ")).join("\n");
}
