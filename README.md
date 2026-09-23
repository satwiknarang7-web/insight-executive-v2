# Insight Executive

Upload a CSV, get an analysis you can defend. Insight profiles your data, builds
the charts an analyst would build, computes every statistic itself, and shows you
the query behind each claim.

Everything — parsing, cleaning, SQL, statistics — runs in your browser. Every
number in a report is computed on your own device from your own rows.

When a model is in use, a **summary** of the table goes out and is used to
decide what the report is *about* and which questions it answers: the column
names, each column's distinct values or numeric range, and twenty whole rows
taken at a stride through the file. Nothing else leaves, no figure is ever
computed from it, and everything it comes back with is re-checked against the
rows before it can affect a chart — see "What the dataset is about" below.

A model is in use in two cases: the reader brought their own key (it goes to
their provider, billed to them), or the account is on the Pro plan with no key
of its own (it goes to the deployment's provider — `SERVER_MODEL_PROVIDER`, or
whichever of `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`,
`XAI_API_KEY` is set). Free accounts, signed-out visitors and deployments
without accounts never use the deployment's key. With no model in use nothing
leaves at all.

## How it works

```
CSV file
   │
   ▼
┌──────────────────────────── engine worker (owns the dataset) ────────────────┐
│ 1. Parse       Papa Parse, streamed in chunks                                │
│ 2. Clean       PII redaction, type coercion, blank normalisation, outliers   │
│ 3. Read        tableModel works out grain, units and what may be summed      │
│ 4. Ask         questionCatalogue offers questions; the reader picks on a card│
│ 5. Compile     questionCompiler turns each question into charts + SQL        │
│ 6. Execute     alasql runs each query over the in-memory rows                │
│ 7. Resolve     chartResolver validates each type against its own results     │
│ 8. Verify      insightEngine computes every statistic and writes the prose   │
└──────────────────────────────────────────────────────────────────────────────┘
   │                                              │
   │ a few KB of results                          │ ~10 KB of verified findings
   ▼                                              ▼
  UI (charts, tables, report)              /api/narrate — an LLM rephrases them
```

The language model never produces a number. It receives already-computed
findings and returns better wording, and — on the question card — it may propose
questions, each of which is checked against the rows before it is offered.
**With no API key configured the app works completely**: deterministic prose,
and the catalogue's own questions deciding what the report answers.

### Choosing the charts: questions first

A report answers questions, not a list of charts a schema happens to permit.
The design is in `docs/design/question-first-reports.md`; in short:

1. **Read the table once.** `lib/tableModel.js` decides what a row is (an
   event, one entity, a snapshot, a long table of series), which measures may be
   summed and across what, and which are rates, prices or repeated across a
   join. Every later step reads this instead of guessing again.
2. **Offer questions.** `lib/questionCatalogue.js` lists what this table can
   answer — how a total splits, what moves the outcome, how it changed over
   time, what trades off against what — ranked by how much the rows actually
   say (`lib/chartSignals.js`: eta², trend R², association strength). The
   reader picks on the question card; "choose for me" takes the recommended
   ones. On Pro, or with the reader's own key, a model may add questions
   (`lib/modelQuestions.js`); each is checked against the rows first.
3. **Compile, don't filter.** `lib/questionCompiler.js` turns each question
   into charts that cannot break the report rules (I1–I10): only additive
   measures are shown as parts of a whole, one row never decides an average,
   a long table is never summed across its series, thin evidence does not lead.
   Nothing is generated that would then have to be filtered out, so a question
   whose answer is "no difference" keeps its answer.

The rules are scored against a corpus of real and generated files by
`npm run eval:scorecard`, and the test suite fails if any path scores worse than
`eval/scorecard.baseline.json`.

### Which chart, from the values

`tableModel` decides which charts a *schema* permits and `chartSignals`
measures whether a question has anything to say. `chartAdvisor` answers the
third question: given these result rows, what shape are they?

The rule that governs it is that **nothing here reads a column name**. Not to
find the date column, not to find the geography, not to decide what is a
measure. A file whose columns are called `f1`…`f7`, or are in Turkish, or are
the twelve months written in Japanese, is read the same way as one with English
headers, because the evidence is in the values either way — and a lexicon of
English nouns is a list of the conventions somebody happened to remember. A test
reads the module's own regular expressions and fails if any of them contains a
word like `date` or `revenue`.

The rule held everywhere except the one decision it mattered most for, which is
covered in the next section.

What it reads, and what follows:

| What the values show | What it means for the chart |
| --- | --- |
| Labels shaped like calendar points, evenly spaced | A line, or an area once the series is long |
| Dated but unevenly spaced | Columns — a line would invent the gaps |
| Month names, weekdays, quarters | Calendar order, never sorted by size |
| `< 10`, `10–100`, `100+` | A distribution, in its own order |
| Values adding to 100, or to 1 | Parts of one whole: a donut, or a treemap when there are many |
| Any negative value | No part-to-whole shape at all; a waterfall instead |
| Each step keeping less than half of the first | A funnel — but not a ranking that was merely sorted |
| Two measures that move together | A scatter, with the coefficient in the reason |
| Two measures orders of magnitude apart | An axis each |
| Names that match the boundary file | A map, decided by the values rather than by the column being called "country" |

Every recommendation carries the sentence that earned it, and the chart dialog
shows them against the query's real results — so a person building a chart by
hand is told what their own rows support, and can disagree with a reason rather
than with a black box.

### What the dataset is about

Everything above reasons about *shape*: which column can be summed, which has
the widest spread, which dimension reads legibly as bars. None of it can tell a
dependent variable from an attribute — and that is the difference between a
report about your data and a report about nothing.

It used to be answered by a list of about forty English nouns in
`measureSemantics.js` — `churn`, `medal`, `fraud`, `readmitted` — matched
against column names. A file of occupations carrying
`Automation_Probability_2030` matched none of them, so the analysis had no
dependent variable, so every column was interchangeable with every other, and
the deck led with a record count by whichever category happened to read best.
Every figure in it was correct. It was a report about nothing, and lengthening
the list fixes that file and not the next one.

So `/api/semantics` now also asks a model what the table is a record of, and
`lib/datasetBrief.js` **believes none of the answer**. Every claim is re-derived
from the rows before it can reach the planner:

| The model says | What has to be true of the rows |
| --- | --- |
| this column is the outcome | it exists, under any spelling of its name |
| it is binary / continuous / ordinal | the values have that shape, at this row count |
| — | nothing else in the table *determines* it |
| this level is the event | the column actually holds that value |
| this column is a driver | it measurably moves the outcome, by the statistic that fits the pair |

A claim that fails is dropped with its reason, and a brief that loses every
claim is the same object as no brief at all — so no provider, no key, a timeout
or a model talking nonsense all degrade to the behaviour that shipped before it.

The outcome then drives the deck, in the four shapes datasets actually record
one: a flag's rate, a probability's mean, the share sitting at an ordinal's
severe end, the share of a named class. `outcomeAggregate` writes the SQL, the
label and the number format together, because on a continuous outcome a mean
labelled "Rate" on a percentage axis is three bugs that raise no error.

Two guards travel with it. A column computed by **banding** another — a
`Risk_Category` of Low/Medium/High cut from a probability — is refused as a
breakdown of the column it came from, because that chart is a definition with
bars around it and it arrives tagged as strong evidence. And a **ratio a model
invents** is measured before it becomes a column: one report led with
"Salary Per Experience Year", whose two columns correlate at 0.017, making the
quotient a measure of how small the denominator happened to be. A formula
somebody typed is never second-guessed; only what a model volunteered.

### Is the report about the dataset?

`tests/corpus.test.mjs` is the test that could have caught the failure above,
and the unit tests could not. Each `tests/corpus/<name>.csv` sits beside a
`<name>.expect.json` saying what a correct report on it must contain, must not
contain, and must refuse — including the specific wrong charts that shipped. No
model is called: the expectation carries the brief a correct one would return,
so what is under test is that a right brief produces a right report, a wrong
claim inside it is caught, and no brief at all still produces a deck.

When a report comes out wrong on a new file, the file goes in the corpus, the
expectation describes the report it should have produced, and the engine gets
fixed rather than the expectation. That is what stops this being solved one
dataset at a time.

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

## Where the data comes from

Everything is in one searchable catalog on Home, grouped the way people think
about it. A file dropped in the browser is parsed there and never uploaded; a
link or a database is fetched by the server and handed straight to the browser,
which is stated on screen because it is a different promise.

| Group | Sources |
| --- | --- |
| Files | CSV, TSV and delimited text · Excel and ODS workbooks · JSON and NDJSON · XML · HTML pages · Parquet · SQLite · pasted text |
| Web and APIs | any file behind a link · Google Sheets · a REST endpoint returning JSON · an OData feed · the tables on a web page |
| Databases | PostgreSQL · Neon · Supabase · Amazon Redshift · CockroachDB · Timescale · AlloyDB · RDS and Aurora · MySQL · MariaDB · TiDB · PlanetScale · SingleStore · SQL Server · Azure SQL · Oracle |
| Warehouses and lakehouses | Snowflake · Databricks SQL · ClickHouse · Trino, Presto and Starburst · Microsoft Fabric |
| Platforms | Tableau published data sources · MongoDB · Airtable |

**A photograph or a PDF is its own way in**, not one file kind among nine. It
reads several pages at once, and what comes back is shown as an editable grid
before anything is loaded: every cell can be typed over, columns renamed and
rows removed. The cells the model marked as unsure are highlighted, and
correcting one clears its doubt — a cell somebody has typed over is a cell they
have vouched for. Whatever doubt is left travels with the data and caps the
findings that rest on it. A model reading a photographed table is right most of
the time, and most of the time is not a basis for a total.

Several of these are flavours of a driver that already existed — Redshift and
Timescale speak Postgres, PlanetScale speaks MySQL — and they exist as separate
entries because the host, the port and the defaults differ, not the protocol.
ClickHouse, Databricks and Trino have no driver package at all: each answers
plain HTTP, so each is a few dozen lines against its own REST protocol.

**A link is rewritten before it is fetched.** A Google Sheet is pasted as its
editing page and served as a CSV export; a GitHub file as the page that renders
it and served raw; a Dropbox share as a preview. The rewrite happens in the
browser and is shown, so the address that will actually be read is visible
before anything is read. The fetch itself goes through `/api/fetch`, which
resolves the host and refuses a private one, follows redirects by hand so a
public URL cannot bounce into an internal one, caps the body and times out —
the same guards the database connectors use, for the same reason.

## Pages

The tab is named for what the page does rather than for where it sits, so
somebody arriving can find a thing without having learned the vocabulary first.
"Home" and "Dashboard" both read as a landing page; "Profile" and "Settings"
both read as your own preferences; "Explore" does not say that the rows are in
there. Each nav label is also the page's own title, so the tab you clicked and
the page you land on agree.

| Route | Tab | What it does |
| --- | --- | --- |
| `/home` | Get data | Load a file, a link or a database, and see what arrived |
| `/dashboard` | Dashboard | KPIs, executive summary, every finding as a chart card |
| `/insight/[id]` | — | One finding in depth: chart, verified metrics, the SQL |
| `/explore` | Data table | The rows, the shaping steps and the measures over them |
| `/ask` | Ask a question | Plain English in, a chart and its query out; includes a SQL console |
| `/measures` | — | Name a calculation once and reuse it on cards and charts |
| `/quality` | Cleaning report | What was changed on the way in, per-column stats, full query audit |
| `/settings` | Settings | Lighting, material, and the guided tour |
| `/profile` | Account | Saved analyses, stored connections, sign-in |
| `/present` | Slideshow | Full-screen deck (arrow keys, space to autoplay) |
| `/report` | Report | Print-ready long-form report |

## Cleaning

Cleaning decides what a value *is*, and every decision it makes is one the
reader can see and disagree with. Beyond parsing and PII redaction:

- **Dates in the forms people write them.** `5 Jan 2024`, `Jan 5, 2024`,
  `05-Jan-24`, `31.12.2024`, `March 2024`, `2024-03` — all read at UTC, so the
  day on screen is the day in the file wherever the reader is sitting. A
  dotted date is day-first unless that cannot be.
- **Scale letters.** A column of `1.2K` and `$3M` becomes numbers — but only
  where the column is otherwise numeric. A column of sizes reading `5M`, `XL`,
  `Regular` stays text, because there `5M` is a size.
- **Spellings of one category.** `North`, `north` and ` NORTH ` are one region
  written three ways by three people, and four bars where there should be one
  is the kind of wrong that stops a reader trusting the rest of the page. Each
  group folds into its most frequent spelling. Never in a column with more
  distinct values than a category can have, where a near-duplicate is far more
  likely to be two people than one name.
- **Empty columns** are removed, and **a title and a stamp above a CSV header**
  are cut using the same scorer workbooks already use for sheets. Blank or
  repeated header cells get names of their own rather than overwriting a
  neighbour.

Each of those is reported as a notice on the dashboard, with the values that
were folded listed on `/quality`. A decision stated with no way to see it is
not a disclosure.

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

## How it looks

Each finding on the dashboard can be sized: a third of the row, a half, two
thirds, or the whole row on its own. Every card used to be the same rectangle,
which said every finding mattered equally — a twelve-month trend and a two-slice
donut beside it are not the same thing. The size is a share of a row rather than
a pixel width, because a dashboard is read at every width between a phone and a
wall display, and it carries the chart's height with it: a full-width chart left
at a third-width height is a letterbox, which is the one shape a trend line
cannot be read in. A deck that sets no size lays out two across, exactly as
every deck did before sizing existed.


Two independent choices, both kept in the browser rather than on the account,
and both set on `/settings`.

**Lighting** is dark or light, and decides the ground, the ink and the accent
ramp. **Material** is what a panel is made of, and is the one worth looking at:

| Material | What it is |
| --- | --- |
| Glass | A translucent plane over a lit ground, held by a hairline edge. The default. |
| Clay | An opaque moulded plane, lit from above, with no edge at all. |
| Neumorphic | No plane: the ground itself, pushed out or pressed in by light. |

They are orthogonal on purpose — somebody who likes clay and turns the lights
on should get light clay, not lose their material — so each lives on `<html>` as
its own attribute, `data-theme` and `data-surface`, applied by a blocking script
before first paint. Dark and glass carry no attribute at all, which is what lets
that script do nothing in the common case.

`lib/appearance.js` owns the model, `app/appearance.css` owns the materials, and
`.card` is defined once in `globals.css` entirely in tokens the materials set —
so a component never knows which material is on. Where a material is borderless,
the hairline utilities the app draws its own controls with are neutralised for
it, and anything interactive that asked for a border is given that material's
lift instead: the border on a chip is an affordance, not a decoration.

### Typography

Three faces, each doing one job: a serif for page titles, a humanist sans for
the interface, and a monospace for the things that have to line up. The app
previously set all four jobs in one geometric sans at black weight in wide
letter-spaced capitals, which is why every screen read as the same screen — a
heading and a table header differed only in size. Tracking and weight on small
uppercase text are also dialled back centrally rather than in the 230 places
they were spelled out inline.

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
