# Insight Executive

Upload a CSV, get an analysis you can defend. Insight profiles your data, builds
the charts an analyst would build, computes every statistic itself, and shows you
the query behind each claim.

Everything — parsing, cleaning, SQL, statistics — runs in your browser. Rows never
leave the device.

## How it works

```
CSV file
   │
   ▼
┌──────────────────────────── engine worker (owns the dataset) ────────────────┐
│ 1. Parse       Papa Parse, streamed in chunks                                │
│ 2. Clean       PII redaction, type coercion, blank normalisation, outliers   │
│ 3. Plan        analystPlanner proposes candidate charts + SQL                │
│ 4. Score       chartSignals measures what each candidate would actually show │
│ 5. Execute     alasql runs each query over the in-memory rows                │
│ 6. Resolve     chartResolver validates each type against its own results     │
│ 7. Verify      insightEngine computes every statistic and writes the prose   │
└──────────────────────────────────────────────────────────────────────────────┘
   │                                              │
   │ a few KB of results                          │ ~10 KB of verified findings
   ▼                                              ▼
  UI (charts, tables, report)              /api/narrate — an LLM rephrases them
```

The language model never sees your rows and never produces a number. It receives
already-computed findings and returns better wording. **With no API key configured
the app works completely** — it just uses the deterministic prose instead.

### Choosing the charts

The playbook in `analystPlanner` decides which charts a *schema* permits: which
columns can be summed, which can only be averaged, which categories are worth
grouping by. That question is answered without looking at a single value, which
is why it cannot answer the one that follows it. "Average order value by region"
is a well-formed chart; if every region sits within a percent of the mean it is
also six bars of the same height and a sentence that says nothing.

So every candidate is measured against the real rows before the deck is chosen
(`lib/chartSignals.js`), using the statistic that matches the question it asks:

| Question the chart asks | What decides whether it has an answer |
| --- | --- |
| How is the total split? | Total variation distance from an even split |
| Does the category explain the measure? | Eta squared — spread between groups against spread within |
| Is this a trend? | R² of the fitted line, scaled by how far it actually moved |
| Do these two move together? | Pearson, discounted for sample size and for Spearman disagreement |
| Does this distribution have a shape? | Departure from flat, lifted by skew |
| Is this a dimension we already charted? | Cramér's V against every dimension already picked |

The score shifts a candidate up or down two playbook tiers, so evidence can
overturn the prior without a striking treemap displacing a real trend. The same
preview also fixes decisions the schema cannot make: long category names become
horizontal bars, a donut whose visible slices are not most of the whole is drawn
as a ranking instead, a short series is a line rather than a mostly-empty area,
and histogram bands are sized by Freedman–Diaconis rather than fixed at four.

### Writing the findings

`insightEngine` computes every number and writes prose that a language model may
rephrase but never correct. Two things govern how far that prose goes:

- **An evidence tier per finding** — `strong`, `moderate`, `indicative`, `thin` —
  derived from sample size, effect size, truncation, and analyzer-specific tests
  (a correlation inside what chance produces is capped at `indicative`, whatever
  its coefficient). The tier is the ceiling on the verb: `strong` says do
  something, `thin` says what is missing. It is sent to the narrator as a fact it
  may not upgrade.
- **Observations that compete on weight** — each analyzer offers every sentence
  the data supports, weighted by how much this dataset justifies saying it, and
  the heaviest few are kept. A flat field and a top-heavy one are described by
  different sentences rather than one template with different nouns in it.

The summary also reconciles findings against each other, which is where the
useful sentence usually is: a segment taking 61% of revenue on 9% of the orders
is a fact neither chart contains. Reconciliation is arithmetic over numbers both
analyzers already verified, and it refuses pairs it cannot compare honestly —
two shares measured against different wholes, or a share of a sum against a
share of a set of averages.

## Pages

| Route | What it does |
| --- | --- |
| `/` | Upload or pick a sample dataset |
| `/dashboard` | KPIs, executive summary, every finding as a chart card |
| `/insight/[id]` | One finding in depth: chart, verified metrics, the SQL |
| `/explore` | Column profile, the shaping steps, the measures, and a paged, sortable, searchable table |
| `/ask` | Ask a question in plain English; includes a SQL console |
| `/measures` | Name a calculation once — described in plain English — and reuse it on cards and charts |
| `/quality` | Cleaning report, per-column stats, full query audit |
| `/present` | Full-screen slide deck (arrow keys, space to autoplay) |
| `/report` | Print-ready long-form report |

## Shaping the data

Cleaning decides what a value *is*. Shaping is the layer above it — what
Power Query does — and it lives on `/explore`, beside the rows it changes.
Every step is one `SELECT` over the result of the step before it, and the
panel shows the query each one became:

| Kind | What it does |
| --- | --- |
| derive, conditional, bucket, datepart, split, merge, index | Add a column: a formula, a CASE, bands of a number, the month of a date, the two halves of "City, ST", several columns joined, a row number |
| rename, retype, keep, drop | Change the shape: a new name, a column read as number / whole number / text / date, a subset of columns, one fewer |
| text, replace, fill | Change values in place: trim and case, swap a value or text inside it, put something in the blanks |
| filter, blanks, dedupe, sort, limit | Change the rows: keep or remove by a condition, drop blank rows, remove duplicates (whole-row or by key), order, keep the top N |
| group, unpivot, pivot | Change the table: summarise to one row per key, turn columns into rows, turn a category's values into columns |

A step can be built from a form, or typed as a sentence — "split City on the
comma into Town and State", "extract the month from Order Date", "group by
Region: total Revenue, number of orders". A deterministic parser
(`lib/transformLanguage.js`) reads the common shapes with no API key; what it
cannot read goes to the model, and either way the result is planned against
the real column list before it is offered. Formulas are checked by the same
validator a measure goes through, so a step cannot become a query, and every
function a formula may call is one `lib/engineFunctions.js` registers — the
null-safe versions, because `UPPER(null)` throws in alasql and a blank cell is
the most ordinary thing in a spreadsheet.

The confidence store follows the columns through all of it: a renamed column
keeps its doubt, a derived one inherits the worst of its inputs, a grouped one
inherits the column it aggregates.

### The analyst prepares the table first

With a model key, the first analysis of a dataset starts with a preparation
pass (`/api/prepare`). The model is shown the columns, the values each
category column holds, the range of each number and a few whole rows — the
same briefing the semantics pass sees — and asked what it would do before
opening the chart menu: the margin column the file should have had, the month
out of the order date, the two fields in one address column, the bands the
business talks about, and the two or three measures worth a card.

What comes back is checked step by step against the real columns, in order,
and then split along one line: **a step that only adds a column runs on its
own**, so the planner charts the margin and draws the trend over the month;
**a step that removes or changes anything is offered** in Explore with the
model's reason, for a person to accept. Its measures are saved, put on the
dashboard as cards, and charted against the column it named. The dashboard
says what was done and links to the steps, each with its query.

Without a key the table is analysed as it arrived, which is what every
analysis did until now.

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000 and drop in a CSV, or click one of the three built-in
samples.

### Optional: better prose

There is no deployment model key. Anyone who wants a model to rephrase the
computed findings — or to ask natural-language questions on `/ask` — connects
their own Gemini key in the app, and it is billed to their own account. Nothing
needs to be configured to run Insight, and this deployment never spends anyone
else's credit on a viewer's request.

Without a key, every number, chart and finding is still computed and shown; the
wording is the deterministic prose, and `/ask` falls back to matching your
question against the planner's own charts.

### A note on `xlsx`

One dependency does not come from the npm registry:

```json
"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
```

SheetJS stopped publishing to npm after 0.18.5 in March 2022 and moved to their
own CDN. That version is not a substitute: it carries two high-severity
advisories — [prototype pollution](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6)
(fixed in 0.19.3) and [ReDoS](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9)
(fixed in 0.20.2) — and neither fix was ever published to npm. For an app whose
job is parsing spreadsheets it did not write, pinning back to the registry would
trade a build inconvenience for two real vulnerabilities.

The cost is that `npm install` needs to reach `cdn.sheetjs.com`. On a network
that blocks it the install fails outright with a 403, and every later command
fails with missing modules. `npm test` checks for this first and says so.

## Tests

```bash
npm test
```

Covers the pure analytic modules — the planner, the signal statistics, the chart
resolver, the insight engine and formatting — plus the pipeline's chart-type
guards and the light-theme contrast contract.

## Performance notes

On a 200,000-row, 15 MB CSV:

| Step | Time | Main thread |
| --- | --- | --- |
| Parse, redact, clean, profile | ~4 s | one 80 ms task |
| Plan, score, run 6 queries, compute stats | ~2 s | one 250 ms task (first chart paint) |
| Filtered search across all columns | ~40 ms | none |
| Payload sent to the LLM | 10 KB | — |

The dataset lives in the engine worker and is never copied to the main thread; the
UI asks for a page of rows or one chart's aggregated results and gets back
kilobytes.
