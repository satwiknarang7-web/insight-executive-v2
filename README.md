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
| `/explore` | Column profile plus a paged, sortable, searchable table |
| `/ask` | Ask a question in plain English; includes a SQL console |
| `/measures` | Name a calculation once — described in plain English — and reuse it on cards and charts |
| `/quality` | Cleaning report, per-column stats, full query audit |
| `/present` | Full-screen slide deck (arrow keys, space to autoplay) |
| `/report` | Print-ready long-form report |

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000 and drop in a CSV, or click one of the three built-in
samples.

### Optional: better prose

Set any one of these to have an LLM rephrase the computed findings, and to enable
natural-language questions on `/ask`. Create `.env.local`:

```
GROQ_API_KEY=...
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
```

They are tried in that order and each is optional. Without them, `/ask` falls back
to matching your question against the planner's own charts.

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
