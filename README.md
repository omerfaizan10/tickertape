# Tickertape

Agents that read 10-K filings, graded by the SEC.

Every US public company files its annual financial statements twice: once as the human-readable 10-K, and once as structured XBRL data. Tickertape has agents read the first and grades them against the second, for the exact same filing and period. The agents never see the XBRL. It's the answer key.

## Results

On a golden set of the latest 10-K from 54 large US companies across tech, banks, healthcare, consumer, energy, industrials, telecom and utilities, with `gpt-4o-mini`:

|                           |                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------- |
| **Figure accuracy**       | **538 / 539 (99.8%)** exact against the SEC's XBRL, sign included                     |
| **Misread figures**       | 0 (every figure is read from the printed cell, not from the model's claim)            |
| **Cost / latency**        | about $0.001 and 3 seconds per filing                                                 |
| **Restatement detection** | **12 / 12** real restatements caught, **0** false alarms across 521 unrevised figures |

Full reports: [`eval/results.md`](eval/results.md) (extraction) and [`eval/revisions.md`](eval/revisions.md) (restatements), including every miss.

## How it works

```
EDGAR ─► locator (code) ─► income / balance / cash flow agents (parallel)
                         ─► reader (code) ─► reconciler (code) ─► one targeted retry
                         ─► last year's 10-K, same pipeline ─► restatement check (code)
                         ─► explainer agent (quotes checked against the filing)
```

- **Locator (code).** Pulls the 10-K and any Exhibit 13 annual report it incorporates from EDGAR, strips every inline XBRL tag and hidden element, and scores every table to find the three primary statements. A statement title appears 22 to 138 times in a single filing, so the title alone can't find it; the scorer also uses required rows, size, column count and a list of lookalikes (parent-only, consolidating, segment, average-balance and multi-year summary tables).
- **Three statement agents.** One per statement, in parallel. Each sees its statement as numbered rows and names the row that holds each figure. That's the only judgment in the extraction path.
- **Reader (code).** Takes the current-period cell from the named row, working out which column is this year from the header (including retail fiscal years labeled a year behind), and applies the statement's unit and the printed sign. If the agent's own reading of the figure disagrees with the cell, the cell wins and the mismatch is recorded.
- **Reconciler (code).** Checks the picks against the statements' own totals: total assets against total liabilities and equity, minority-interest and preferred-dividend lines, continuing vs total EPS. A failed check re-runs only the implicated agent, once, told exactly what failed.
- **Restatements.** The same pipeline reads last year's 10-K. Code compares last year's figures as this year's 10-K reprints them against as they were first reported, lining up the same line in both years by label and section header. Anything more than rounding apart is flagged, and an explainer agent reads the filing's own passages about prior-period changes and must quote the sentence it relies on. The quote is checked word for word; an explanation without a verified quote is shown as unconfirmed.

## Why grade it this way

- **The answer key is the SEC's.** Every graded figure is the company's own XBRL value for that filing and period. An audit checks that each one is actually printed on the statement the agents read (539 of 542 are), and only those are scored, so nothing is graded on a number that isn't on the page.
- **It refreshes itself.** Any new 10-K comes with its XBRL, so the golden set can be rebuilt with filings made after a model's training cutoff.
- **Finding and reading are measured apart.** Locating the statement is deterministic code, checked on its own, so the accuracy number measures reading.
- **Every check that can trigger a retry was tested against the correct answers first.** Across all 54 filings none of them flags a correct answer. The one check that did (cash flows tying to the change in cash, which breaks on discontinued operations and restricted cash) is reported but never acted on.

## What I learned building it

The same lesson kept coming back: when the model can't reliably make a judgment, confirmed by testing, compute it in code from data the pipeline already has, and leave the model only the part that needs language understanding.

- Given the right row, code reproduces the SEC value 539 out of 539 times. So I stopped asking the model for numbers and only ask it for rows.
- The first full eval was 97.2%. The misses weren't random: bank net income after preferred dividends, EPS from continuing operations, a summary table mistaken for a cash flow statement. Each became either a code check or a locator rule, and each check was tested for false alarms before it was allowed to trigger a retry.
- Restatement detection started at 75% precision. Every false alarm was the agents picking a different line in each year's filing, not a model misreading a number. Comparing the same line in both years fixed all four without touching recall.
- A few real filing layouts that broke naive parsing: statements filed as a separate annual report exhibit (IBM, Wells Fargo, U.S. Bancorp), a unit stated once per document (Deere), totals printed with no labels (Merck), statement titles in their own table (Chevron), and a bank whose recent-filings list is too short to contain last year's 10-K (Bank of America).

## Running it

Requires Node, a Postgres database, and an OpenAI API key.

```bash
npm install
cp env.example .env.local        # fill in OPENAI_API_KEY, DATABASE_URL, SEC_USER_AGENT
npm run db:migrate
npm run golden:build             # downloads the 54 filings and builds the answer key
npm run eval                     # extraction eval
npm run eval:revisions           # restatement eval
npm run dev                      # dashboard at localhost:3000
```

`SEC_USER_AGENT` must be a name and contact email: the SEC refuses unidentified automated requests. The client stays under the SEC's limit of 10 requests per second.

Set `MOCK_LLM=true` to run the whole pipeline without a model; rows are then picked by label patterns, which exercises the wiring but says nothing about accuracy.

## Stack

Next.js, TypeScript, Tailwind, Postgres (Neon), OpenAI `gpt-4o-mini`, cheerio. The agent loop is hand-rolled, with no agent framework.
