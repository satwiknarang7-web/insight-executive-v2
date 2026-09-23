# Ten-dataset evaluation — 2026-09-21

Ten datasets chosen for their **shape**, because "data agnostic" is a claim
about shape. Ten spreadsheets of sales in different industries would be one
test. Every figure below was produced by the built app (`npm run build && npm
run start`), driven through the real upload path in a browser; the captures are
in `eval/app-output/`. `eval/` regenerates the data and the scores:

    node eval/datasets.mjs        # writes eval/data/*.csv, deterministic
    node eval/clean-score.mjs     # transformation, scored against known answers
    node eval/analysis-score.mjs  # analysis, via lib/pipeline.js

`eval/chain.mjs` reproduces the worker's ingest chain call for call
(`skipPreamble` → Papa → `sanitizeChunk` → `finalizeMetrics` →
`dropEmptyColumns`), because the worker module itself cannot be imported
outside a browser. Where Node and the app disagreed, the app was taken as
truth — it derives extra "band" dimensions that `runAnalysis` alone does not,
and those turned out to matter.

## The datasets

| # | shape | rows × cols |
|---|---|---|
| 1 | event log, 24-month series, additive money | 900 × 7 |
| 2 | outcome table, yes/no target, no time axis | 900 × 7 |
| 3 | long-format panel, one value column holding four different units | 288 × 4 |
| 4 | entity comparison (the AI-subscription file) | 44 × 48 |
| 5 | survey, ten 1–5 scales, free text, a refusal option | 400 × 15 |
| 6 | high-frequency sensor stream, minute resolution | 50,000 × 6 |
| 7 | transactions with refunds — genuine negative amounts | 1,200 × 8 |
| 8 | wide and sparse, 82% blank cells, two all-blank columns | 300 × 58 |
| 9 | every defect at once: preamble, duplicate header, six null spellings, five date formats, six number formats | 62 × 8 |
| 10 | the degenerate shape: one category, one number | 40 × 2 |

## Transformation: 31 of 39 checks pass

What works, and works everywhere: thousands separators, currency symbols,
percent strings, scale suffixes (`1M` → 1000000), accounting negatives
`(123.45)`, scientific notation, European decimals, five date spellings folded
to one, `N/A`/`-`/`null`/`--` to null, case and whitespace variants of a
category folded, all-blank columns dropped **and reported**, 50,000 rows
cleaned in 546 ms.

Three transformation failures, each with a mechanism rather than bad luck:

**1. Six spellings of a boolean stay six columns of nothing.** Dataset 2's
`churned` came through as eight levels — `No` 260, `false` 228, `N` 127, `0`
99, `TRUE` 62, `Yes` 56, `1` 36, `Y` 32. `unifyCategories` folds case and
whitespace, so `Yes`/`yes` merge and `Y`, `TRUE`, `1` do not. The consequence
is not cosmetic: the outcome detector needs a two-level column, so **the churn
rate is never computed**. It is 186/900 = 20.7%. The report instead says "No
accounts for 32.4% of the 6 shown, the largest share of any churned", and never
charts `contract_type`, which is the actual driver.

**2. A Likert column with 8% refusals stops being a number.** `NUMERIC_PURITY`
is 0.95, and "Prefer not to say" on 8% of rows puts the column at 0.92. All ten
of dataset 5's questions became categories, so the survey has **zero measures**
and the KPI strip reads "Age Band Segments 5 / Records Analyzed 400".
"Prefer not to say" then appears as a legend entry and a slicer value.

**3. Two comma conventions in one column poison it.** Alone, 13 of 14 numeric
formats parse (unicode minus `−567.89` is the one that does not). Mixed, only 5
do — and the trigger is specific: a column holding **both** `2,345.00` and
`1.234,56` cannot have its comma convention resolved, so `resolveCommaNumbers`
abstains and *every* comma-bearing value stays text. The column then falls
below the numeric threshold and becomes a category. In dataset 9 `amount`
became a dimension, and the deck went on to chart "Total Qty **by Amount**" and
offer `Amount` as a slicer.

Abstaining is the right call — guessing is wrong by a factor of a hundred — and
it *is* reported on the cleaning page. What is missing is the consequence: the
deck contains no money and nothing next to the deck says why.

**Fixed during this evaluation.** A file with a title line above the header AND
any column blank in every data row lost its header completely: the whole table
parsed into one column named after the report title. `findHeaderRow` awarded
"the table continues below this row" on *filled* cells, so a header naming an
always-empty column was wider than every row beneath it, lost the bonus, and a
data row outscored it. Both conditions are ordinary in a BI export. Now scored
on columns spanned. `tests/workbook.test.mjs`.

## Analysis: 3 good, 3 partial, 4 wrong

| # | verdict | what the app produced |
|---|---|---|
| 1 | good | revenue trend, waterfall of monthly movement, region mix over time, revenue distribution. Correct totals. |
| 2 | **wrong** | target column unusable; no churn rate; two donuts of a broken column; `contract_type` never charted |
| 3 | **wrong** | "GDP (current LCU) leads indicators on average value at 4560B, 4.0× the 1140B average" — GDP averaged against life expectancy, badged **STRONG EVIDENCE** |
| 4 | good | three per-plan charts, prices and cost per intelligence point (this is the file fixed on 09-19) |
| 5 | **wrong** | zero measures; two charts counting respondents per Likert level; no mean score for any question |
| 6 | partial | 50k rows in 173 ms, but the KPI is "Average Reading Ts Hour" (the mean hour of day, 11.5) and temperature is never charted |
| 7 | partial | negatives handled correctly end to end; but "Units per Order by Txn Type" and "Average Qty by Txn Type" are the same chart twice, and a 3.5-vs-−0.73 comparison is printed as "4.7×" |
| 8 | weak | 58 columns, and the headline is "Average Field 35 = 217.9" — an arbitrary pick among 53 equivalent columns |
| 9 | **wrong** | money column used as a chart dimension and a slicer; "N Share Of Records trended up from **(not stated)** to 2026-08" |
| 10 | good | "Average Points by Team", "Record Count by Team" — appropriately modest |

### The single most common defect: a measure charted against buckets of itself

Present in 5 of 10 datasets, and the **first chart** in four of them:

- `Total Revenue by Revenue Band` — STRONG EVIDENCE — "20000–50000 leads revenue bands on total revenue at 9.7M, 43.4% of the total"
- `Total Monthly Charge Trend Over Monthly Charge Band` — MODERATE — and a waterfall of the same
- `Total Qty by Qty Band` — STRONG — "50+ leads qty bands on total qty at 1.8K, 74.6% of the total"
- `Average Points by Points Band` — MODERATE — "500+ leads points bands on average points at 717.7, 1.8× the 399.2 average"

Each is a tautology. The sum of X inside the top band of X is the largest by
construction; the mean of the 500+ bucket is above the overall mean by
definition. A *histogram* of a measure is legitimate — count by band. Summing
or averaging a measure over bands derived from that measure is not a finding,
and "STRONG EVIDENCE" on it is the worst kind of wrong: arithmetically correct
and completely empty. Calling a band axis a "Trend" compounds it.

### Second: an internal flag leaks in, depending on row order

`isAnomaly` is the cleaner's own outlier marker, set only on rows that are
outliers. `profileColumns` reads the column list from `rows[0]`, so whether the
flag becomes a chartable dimension depends on whether the first row happens to
be an outlier. Dataset 3 exposed it; dataset 1, with more outliers, did not.
That is the "sometimes yes, sometimes no" pattern in its purest form.

### Third: time bucketing has no resolution below a month

Dataset 6 covers 34.7 days at minute resolution. The trend buckets to month,
producing two points — a full January and four days of February — and reports
"Record Count trended down from 2026-01 to 2026-02, a 88.0% decrease". The
rule picks years past 96 months and months otherwise; there is no day or hour
branch, so every sub-monthly series gets two or three points and a spurious
cliff at the end.

## Answer to the question

Not yet data agnostic. It is dependable on the shape it was built for — an
event log with dates and money that add up (1, 7) — and on entity comparisons
since the 09-19 work (4), and it is sensibly modest on a trivial table (10).

It fails on four shapes, and the failures are **not** random. Three of the four
come from one property: **a column the typing rules reject silently becomes a
category, and nothing downstream knows the difference.** A boolean written six
ways, a Likert scale with a refusal option, a money column with two comma
conventions — each one leaves a table whose most important column is a
dimension, and the analysis then does the only thing it can with a dimension:
count rows by it.

The fourth is judgement rather than typing: what a table is *for*.

---

# After the fixes — same ten datasets, same method (2026-09-21)

Seven defects fixed. Every figure below is the built app again, re-run from a
clean build; `eval/app-output/` holds the captures.

**Transformation: 31 → 34 of 39.**

| fix | effect |
|---|---|
| Fold the spellings of a boolean | `churned` went from eight levels to two, so the outcome detector fires. **The KPI strip now leads with "Churn Rate 20.7%"** — the figure that was never computed — and "Churn Rate by Contract Type" is the first chart at strong evidence: Month-to-month 37.2%, 1.9× the average. Applied only when *every* non-blank value is a true/false token, so Yes/No/Maybe is untouched. |
| Read a declined answer as missing | "Prefer not to say" and twelve siblings join `n/a`. The survey went from **zero measures to ten**; the strip reads "Average Q1 Ease 2.8" and the deck reports mean scores by age band and by status instead of counting respondents per Likert level. |

**Analysis: 3 good → 6, and four wrong → two.**

| fix | effect |
|---|---|
| Never aggregate a measure over bands of itself | **All five band tautologies gone, across all ten datasets.** "Total Revenue by Revenue Band" and its kin no longer exist. A histogram — *count* by band — is untouched, and so is "Average Discount Pct by Revenue Band", which is a real question. |
| A name hint needs the values to back it up | `Monthly Charge Band` matched `TEMPORAL_KEY_RE` on the word "month" and became the time axis, so the deck carried "Total Monthly Charge **Trend** Over Monthly Charge Band" and a waterfall of what moved it between bands. A date hint now needs one value that reads as a date. |
| An hour pulled from a timestamp is a label | The sensor stream's headline was "Average Reading Ts Hour 11.5" — the mean hour of the day. It now reads **"Average Temperature C"**, and the deck charts temperature against humidity. Matched on the prefix naming a column that exists, so a reader's own "Delivery Hour" is still a measure. |
| A grouping column is the label, whatever its type | The same scatter's title said temperature and its sentence said "Reading Ts Hour and Average Humidity Pct show a **strong** negative relationship (r = -0.79)". `extractSeries` wanted a string for its label, found none, took the x measure instead and left the grouping column looking like a measure. It now reads "Average Temperature C and Average Humidity Pct line up loosely (r = -0.22) … within what chance produces" — the right pair, the right number, honestly qualified. |
| `isAnomaly` is not data | The cleaner's outlier flag is set only on outlier rows and the column list is read from `rows[0]`, so it became a chartable dimension when row 0 happened to be an outlier. Excluded in the profile, as `lib/dataModel.js` already did. |

Dataset 10 went from three charts to two, which is correct: the chart removed
was the tautology, and it had scored *well* — a tautology has perfect signal by
construction. What is left genuinely says little, and the deck now says so
instead of padding.

## What is still wrong

- **Dataset 3.** "GDP (current LCU) leads indicators on average value at 4560B"
  — GDP averaged against life expectancy, still badged STRONG EVIDENCE. A long
  panel needs the value column split by its unit column, which `FILTER` or
  `UNPIVOT` can do and no rule asks for.
- **Dataset 8.** "Average Field 35" is still the headline of a 58-column file.
  An arbitrary pick among 53 statistically equivalent columns; nothing in the
  data says which one matters.
- **Dataset 9.** `amount` is still a dimension, because it holds both comma
  conventions and the cleaner refuses to guess. The refusal is right and it is
  reported on the cleaning page; the deck still contains no money and nothing
  beside the deck says why.
- **Dataset 6.** A 35-day minute-level series still buckets to month, draws two
  points and reports an 88% fall. There is no branch below a month.
- **Dataset 7.** "Units per Order by Txn Type" and "Average Qty by Txn Type"
  are the same chart twice, and 3.5 against −0.73 prints as "4.7×".
- Unicode minus (`−567.89`, U+2212) is still not read as a number.

Three of those six are judgement — which column matters, what the table is for
— and are what a model pass is for. Three are ordinary bugs.

---

# The six remaining defects, fixed — and the deck composer (2026-09-21)

Re-run from a clean build; `eval/app-output/` holds the captures. Zero band
tautologies and zero page errors across all ten.

| # | KPI strip before the whole exercise | now |
|---|---|---|
| 1 | Total Revenue … | unchanged |
| 2 | Total Monthly Charge | **Churn Rate 20.7%** |
| 3 | Average Value 1140107.0M | *(no pooled value; counts only, honestly)* |
| 4 | Average Min Seats 8.8 | Average Monthly Price USD |
| 5 | Age Band Segments 5 | **Average Q1 Ease** |
| 6 | Average Reading Ts Hour 11.5 | **Average Temperature C** |
| 7 | Total Amount … | unchanged |
| 8 | Average Field 35 217.9 | **Average Score** |
| 9 | Total Qty … | unchanged, and `amount` no longer charted as a category |
| 10 | Average Points … | unchanged |

Fixed: unicode minus and en dash read as minus signs; trend grain chosen by
counting the points each would draw, so a 35-day minute-level series charts by
day instead of drawing two months and reporting an 88% fall; a column the
cleaner refused to type is withheld from both lists and said in a notice
instead of becoming a chart axis; a value column whose typical size differs by
three orders of magnitude across a key is never pooled; near-uniqueness alone
no longer makes a continuous measure an identifier; a measure filled on a sixth
of the rows no longer headlines a file; two charts of the same drawn numbers
become one; a multiple is not quoted across a change of sign.

Two pre-existing faults surfaced while making those pass, both previously
masked: `UNIT_COLUMN_RE` matched a column called `units` and withdrew revenue
from every sum in the deck; and the boolean fold picked its spelling by
frequency alone, folding a churn column to `Yes` and `0`.

## The deck composer

`lib/deckComposer.js` + `app/api/compose/route.js`. A model is shown the
schema, what the purpose pass settled, and six whole rows, and returns chart
specs with their SQL. It runs after the purpose pass and before planning, on a
20-second deadline.

**The contract is unchanged.** The model chooses the questions; the engine
computes every answer. A composed chart is executed against the reader's own
rows by the same engine, resolved by the same resolver, analysed by the same
insight engine, graded on the same evidence scale, and put past the same
sceptic and critic. Nothing downstream knows which pass chose a chart.

Three refusals, each tested:

- not a single read-only SELECT — `assertEngineSelect`, shared with `/api/ask`;
- **a query naming a column the table does not have** — the check `/api/ask`
  never had, and the one that matters most: a model writing `[Total Revenue]`
  on a table without one produces a query that fails at runtime or an empty
  chart under a confident title. Aliases the query defines with `AS` count as
  known; case and spacing are forgiven;
- a chart shape this app cannot draw. `canonicalType` answers `bar` for
  anything it cannot place, which would have drawn a sankey as a bar chart
  under its own title, so the raw name has to be recognised.

A spec that fails is dropped and the rest are kept, with the reasons returned
on `skipped`. When nothing survives the result is empty and the planner runs
exactly as it does today, so a bad answer costs one model call. When something
does survive, the planner still tops the deck up — a model returning three
usable charts does not leave a deck of three.

**Untested against a real model.** There is no key in this environment, so the
route was exercised only through its validation and its no-provider path
(`{"unavailable":true,"reason":"no_provider"}`), and `runAnalysis` was driven
with hand-written specs through `acceptDeck`. What a model actually composes,
and whether it beats the planner on datasets 3, 8 and 9, is the experiment this
makes possible and has not yet run:

    node eval/analysis-score.mjs     # the planner, as measured above
    # with a key configured, upload the same ten through the app

---

# Phase 0 baseline — question-first scorecard (2026-09-23)

The first measurement for `docs/design/question-first-reports.md`. Nothing in
the engine changed; this is the engine as it stands, scored in a way that can
fail on the thing that actually goes wrong: a report that is arithmetically
right and does not answer what its file is for.

**How it is measured.** 29 files in `tests/corpus/`: the two that were there,
nine of the ten shapes above, the app's four samples, two small repo files and
twelve new tables, each built around a trap a real file has (a price only
comparable within its buyer unit or currency, a weekly stock level, budget and
actual in one column, one row carrying most of a measure's spread, a month of
hourly data). Each `.expect.json` now carries a `report` section, written by
hand: the table's grain, the ground truth about its measures, and 2–4
questions a report on it must answer, stated as the columns an answer has to
be built from. `eval/audit.mjs` checks rules I1–I10 against that truth, never
against the engine's own reading of the table. `eval/fuzz.mjs` adds 40
generated tables across eight trap archetypes, under column names drawn from
several domains and from meaningless codes.

    npm run eval:scorecard          # this table
    node eval/scorecard.mjs <name>  # every verdict for one file
    npm run eval:baseline           # accept the current result

`tests/scorecard.test.mjs` runs it in `npm test` as a ratchet against
`eval/scorecard.baseline.json`: fewer answers or more rule breaks fail, and so
does an improvement that was not written into the baseline.

## Result

| | answered | files that break no rule | violations |
|---|---|---|---|
| corpus, no model | **19 / 77** | 14 / 29 | 53 |
| corpus, with the recorded brief | 1 / 7 | 0 / 2 | 23 |
| fuzz | — | 18 / 40 | 45 |

| file | grain | path | answered | charts | I1 | I2 | I3 | I4 | I5 | I6 | I7 | I8 | I9 | I10 |  |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ai_jobs | observation | noModel | 0/3 | 2 | · | · | · | · | · | · | · | · | · | 1 |  |
| ai_jobs | observation | withBrief | 1/3 | 2 | · | · | · | · | · | · | · | 1 | · | 1 |  |
| ai_models_api_detail | entity | noModel | 0/3 | 8 | · | · | · | · | · | 2 | · | 2 | · | · |  |
| ai_subscriptions | entity | noModel | 0/4 | 7 | 2 | 1 | 10 | · | 1 | 3 | · | 3 | · | 1 |  |
| ai_subscriptions | entity | withBrief | 0/4 | 7 | 2 | 1 | 10 | · | 1 | 3 | · | 3 | · | 1 |  |
| eval_01_event_log | event | noModel | 1/3 | 4 | · | · | · | · | · | · | · | · | · | · |  |
| eval_02_outcome | entity | noModel | 2/3 | 3 | · | · | · | · | · | · | · | 1 | · | · |  |
| eval_03_long_panel | long | noModel | 0/2 | 3 | · | · | · | · | · | · | · | · | · | · |  |
| eval_05_survey | response | noModel | 0/2 | 3 | · | · | · | · | · | · | · | · | · | · |  |
| eval_06_sensor_stream | event | noModel | 0/3 | 2 | · | · | · | · | · | · | · | · | · | · |  |
| eval_07_refunds | event | noModel | 1/3 | 4 | · | · | · | · | · | · | · | · | · | · |  |
| eval_08_wide_sparse | event | noModel | 0/2 | 3 | · | · | · | · | · | · | · | · | · | · |  |
| eval_09_filthy | event | noModel | 0/2 | 4 | · | · | · | · | · | · | · | · | · | · |  |
| eval_10_two_columns | observation | noModel | 1/1 | 2 | · | · | · | · | · | · | · | 1 | · | · |  |
| gen_ab_test | event | noModel | 0/3 | 4 | · | · | · | · | · | · | · | · | · | · |  |
| gen_budget_vs_actual | long | noModel | 0/2 | 5 | · | · | · | 7 | · | · | · | · | · | · |  |
| gen_clinical_trial | entity | noModel | 0/3 | 3 | · | · | · | · | · | · | · | · | · | · |  |
| gen_energy_hourly | event | noModel | 1/3 | 4 | · | · | · | · | · | · | · | 1 | · | · |  |
| gen_hr_attrition | entity | noModel | 2/4 | 4 | · | · | · | · | 1 | · | · | 1 | · | · |  |
| gen_inventory_snapshots | entityPeriod | noModel | 0/2 | 5 | · | · | 4 | · | · | · | · | · | · | · |  |
| gen_multi_currency_catalog | entity | noModel | 1/3 | 3 | · | · | · | · | · | · | · | · | · | · |  |
| gen_real_estate | entity | noModel | 0/2 | 2 | · | · | · | · | · | · | · | 1 | · | · |  |
| gen_saas_pricing | entity | noModel | 0/2 | 5 | · | · | 3 | · | 1 | 1 | · | 1 | · | · |  |
| gen_student_scores | entity | noModel | 1/2 | 2 | · | · | · | · | · | · | · | · | · | · |  |
| gen_support_tickets | event | noModel | 1/3 | 4 | · | · | · | · | · | · | · | · | · | 1 |  |
| gen_web_daily | event | noModel | 0/3 | 4 | · | 1 | · | · | · | · | · | · | · | · |  |
| repo_sales_data | event | noModel | 2/2 | 6 | · | · | · | · | · | · | · | · | · | · |  |
| sample_campaigns | event | noModel | 1/3 | 4 | · | · | · | · | · | · | · | · | · | · |  |
| sample_churn | entity | noModel | 2/3 | 5 | · | · | · | · | · | · | · | 1 | · | · |  |
| sample_messy | event | noModel | 1/3 | 6 | · | · | · | · | · | · | · | · | · | · |  |
| sample_retail | event | noModel | 2/3 | 6 | · | 1 | · | · | · | · | · | · | · | · |  |

## What it shows

- **A quarter of the questions are answered on the path most people get.**
  The deck is usually valid and usually beside the point. Even the shape the
  engine was built for — an event log with money (`eval_01`) — answers 1 of 3:
  it spends its slots on a revenue trend, a waterfall of the same series and a
  distribution, and never charts revenue by region or by category. "Region Mix
  Over Month" tracks the share of one region.
- **Whole shapes get nothing.** No chart reads the value column of either long
  table, any survey item, the sensor's temperature, or the outcome of the A/B
  test and the trial (`converted`, `improved`, `adverse_event`) — outcomes whose
  names are not on the English list `measureSemantics` recognises.
- **The rule breaks cluster where the design said they would.** I3 (scope) on
  every priced entity table; I4 on budget-vs-actual, where all five charts and
  both KPIs add budget to actual; I8 in 12 files — the "average across N
  groups" sentence is an unweighted mean of group values and disagrees with
  the KPI beside it (churn: 23.2% against 23.9%). A weekly stock level is summed
  per month and totalled in a KPI.
- **The recorded brief barely moves anything.** With the brief a correct model
  would return, `ai_subscriptions` runs the same seven queries — only a KPI
  changes, to "Average Intelligence Index" — and `ai_jobs` gains one answer.
  The model path is not yet where the leverage is.
- **Fuzz**, tables breaking a rule out of five per archetype: scope 5, outlier
  5, outcome 5, long 4, level 2, control 1 (an I8 average), resolution 0,
  rate 0. Sub-monthly series are bucketed by day or hour correctly now; the
  I9 defect recorded above is fixed.
- Found in passing: the support-ticket deck titles a chart "Orders by Product
  Area" — the lexicon naming a table it does not understand.

## Also fixed

`eval/datasets.mjs` copied the subscription file from an absolute path on
another machine and wrote into a directory it never created, so it could not
run from a fresh checkout. It now reads `tests/corpus/ai_subscriptions.csv`
and creates `eval/data/`; CI regenerates the corpus and fails if the committed
files differ from what the generators produce.

---

# Phase 1 — the table model (2026-09-23)

`lib/tableModel.js` reads a table once and says what it is: its grain, which
file is long and by what, and for every measure whether it may be summed,
whether it is a level that must not be summed across time, the columns it is
only comparable within, and whether one row decides its average. Nothing
reads it yet — phase 2's chart compilers are built on it — but it is scored
now, against the same hand-written truth as the reports.

| | tables read correctly |
|---|---|
| corpus | **29 / 29** |
| fuzz | **40 / 40** |

"Correctly" means grain, long format, every scope, every never-summed measure
and every level the truth names, and no scope, level or summing ban the truth
does not have — including on the flows each file lists as `additive`, so a
model that forbade summing revenue would fail.

What reading it took, as general rules rather than per-file fixes:

- **Grain from identity, not names.** A unique column or pair with no time is a
  table of entities; a dense (thing × period) key is a panel; a unique id with
  a timestamp is an event log. Sparse (rep × date) pairs are not a panel — the
  test is density, not uniqueness, which a 479-row order file passes by chance.
- **Long tables by structure plus one of two signs.** Fully crossed on a column
  whose levels either differ a hundredfold in size (GDP beside life
  expectancy) or name a quantity or version (Budget, Actual). Scale alone at
  tenfold would call a sales panel long, because laptops outsell pens.
- **Currency by conversion.** `price_local / price_usd` fixed inside each
  currency and an order of magnitude apart between them. Four false readings
  had to be closed, each now a test: a provider that quotes in one currency
  shows the same fixed ratio (keep the coarsest column); two benchmark scores
  fixed per model have a fixed ratio with nothing converted (the values must
  move inside a level); price per benchmark point is a derived ratio (the
  local column has to swing tenfold and three times its partner); and storage
  grows tenfold with a buyer unit without being denominated in it (money only).
- **Levels by carry-over.** A stock-like name is a candidate; it is a level
  only if each period carries the last one over (lag correlation above 0.5).
  `stock_received` is a flow.

Every rule was checked by mutation: disable it, and a test in
`tests/tableModel.test.mjs` fails.

**Data changes in this phase**, and why the reports baseline moved with no
engine change: the inventory generator drew each week's stock independently,
which no real stock does — it is now a random walk, in the corpus and the
fuzz archetype. Each trap table now reseeds before it is drawn, so editing one
cannot change the rest; that reseed redrew every trap table once, and the
engine's charts moved with the noise (two answers gained, two I8s added) —
worth knowing in itself. Two tables keyed (channel, day) and (meter, hour)
were relabelled `entityPeriod`, consistent with (sku, week); resolution hours
lost their `noSum`, since total handling time is meaningful. Reports, no
model: 21 / 77 answered, 53 violations.

---

# Phase 2 — reports built from questions (2026-09-23)

`runAnalysis` no longer asks the playbook which charts the column types
permit. It reads the table (`lib/tableModel.js`), the catalogue proposes the
questions the table can answer (`lib/questionCatalogue.js`), and each question
compiles into charts that are built to satisfy the rules
(`lib/questionCompiler.js`). The flat-chart, tied-ranking and record-count
filters no longer run on this path: a question whose answer is "no
difference" has been answered, and the chart stays.

| | before (phase 1) | after |
|---|---|---|
| questions answered, no model | 21 / 77 | **62 / 77** |
| questions answered, with the recorded brief | 1 / 7 | 4 / 7 |
| corpus files that break a rule | 15 / 29 | **0 / 29** |
| rule violations, corpus | 53 | **0** |
| rule violations, fuzz (40 tables) | 47 | **0** |

| file | grain | path | answered | charts | I1 | I2 | I3 | I4 | I5 | I6 | I7 | I8 | I9 | I10 |  |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ai_jobs | observation | noModel | 1/3 | 3 | · | · | · | · | · | · | · | · | · | · |  |
| ai_jobs | observation | withBrief | 1/3 | 3 | · | · | · | · | · | · | · | · | · | · |  |
| ai_models_api_detail | entity | noModel | 2/3 | 7 | · | · | · | · | · | · | · | · | · | · |  |
| ai_subscriptions | entity | noModel | 3/4 | 5 | · | · | · | · | · | · | · | · | · | · |  |
| ai_subscriptions | entity | withBrief | 3/4 | 6 | · | · | · | · | · | · | · | · | · | · |  |
| eval_01_event_log | event | noModel | 3/3 | 6 | · | · | · | · | · | · | · | · | · | · |  |
| eval_02_outcome | entity | noModel | 3/3 | 4 | · | · | · | · | · | · | · | · | · | · |  |
| eval_03_long_panel | long | noModel | 2/2 | 2 | · | · | · | · | · | · | · | · | · | · |  |
| eval_05_survey | response | noModel | 2/2 | 4 | · | · | · | · | · | · | · | · | · | · |  |
| eval_06_sensor_stream | event | noModel | 2/3 | 3 | · | · | · | · | · | · | · | · | · | · |  |
| eval_07_refunds | event | noModel | 3/3 | 5 | · | · | · | · | · | · | · | · | · | · |  |
| eval_08_wide_sparse | event | noModel | 0/2 | 7 | · | · | · | · | · | · | · | · | · | · |  |
| eval_09_filthy | event | noModel | 0/2 | 3 | · | · | · | · | · | · | · | · | · | · |  |
| eval_10_two_columns | observation | noModel | 1/1 | 1 | · | · | · | · | · | · | · | · | · | · |  |
| gen_ab_test | event | noModel | 3/3 | 7 | · | · | · | · | · | · | · | · | · | · |  |
| gen_budget_vs_actual | long | noModel | 2/2 | 2 | · | · | · | · | · | · | · | · | · | · |  |
| gen_clinical_trial | entity | noModel | 2/3 | 6 | · | · | · | · | · | · | · | · | · | · |  |
| gen_energy_hourly | entityPeriod | noModel | 3/3 | 4 | · | · | · | · | · | · | · | · | · | · |  |
| gen_hr_attrition | entity | noModel | 4/4 | 5 | · | · | · | · | · | · | · | · | · | · |  |
| gen_inventory_snapshots | entityPeriod | noModel | 1/2 | 5 | · | · | · | · | · | · | · | · | · | · |  |
| gen_multi_currency_catalog | entity | noModel | 3/3 | 6 | · | · | · | · | · | · | · | · | · | · |  |
| gen_real_estate | entity | noModel | 1/2 | 7 | · | · | · | · | · | · | · | · | · | · |  |
| gen_saas_pricing | entity | noModel | 2/2 | 4 | · | · | · | · | · | · | · | · | · | · |  |
| gen_student_scores | entity | noModel | 2/2 | 4 | · | · | · | · | · | · | · | · | · | · |  |
| gen_support_tickets | event | noModel | 2/3 | 7 | · | · | · | · | · | · | · | · | · | · |  |
| gen_web_daily | entityPeriod | noModel | 3/3 | 5 | · | · | · | · | · | · | · | · | · | · |  |
| repo_sales_data | event | noModel | 2/2 | 5 | · | · | · | · | · | · | · | · | · | · |  |
| sample_campaigns | event | noModel | 2/3 | 8 | · | · | · | · | · | · | · | · | · | · |  |
| sample_churn | entity | noModel | 2/3 | 5 | · | · | · | · | · | · | · | · | · | · |  |
| sample_messy | event | noModel | 3/3 | 7 | · | · | · | · | · | · | · | · | · | · |  |
| sample_retail | event | noModel | 3/3 | 8 | · | · | · | · | · | · | · | · | · | · |  |

The subscription file, which started this, leads with "Intelligence Index per
Monthly Price USD, by provider · plan name — Buyer Unit: user": the question it
was built to answer, within one buyer unit.

## How the rules hold

Every rule is met where the SQL is written, not checked afterwards:

- **Scope (I3):** a measure with a scope is filtered to its most common level,
  and the heading says which ("— Buyer Unit: user"). A split the filter leaves
  with one group is not drawn.
- **Long tables (I4):** split by the column naming the quantity — as series
  when the quantities share a scale (budget beside actual), one chart each when
  they do not (GDP, life expectancy).
- **No inventory counts (I5):** entity tables are compared by averages; a
  total across entities is the size of a group, not a property of its members.
- **Outliers (I6):** MEDIAN wherever one row would move a group's average by
  a quarter, and the sentence says "median".
- **One average (I8):** each ranking carries `baselineSql`, the figure over all
  its rows. The sentence reads "2.2× the 23.9% average over all records" — the
  number in the KPI strip — instead of the unweighted mean of the bars (23.2%).
- **Time (I9):** the coarsest grain with four points; a level never coarser
  than it was recorded.
- **What leads (I10):** question order, with thin-evidence charts moved behind.
  A split now shows all its groups (up to twenty) rather than the top twelve,
  which had been costing an evidence tier.

## What the catalogue had to learn, as general rules

Each was a wrong question on some corpus file, fixed for every file:

- **Evidence picks the splits.** Outcome drivers are ranked by how far the
  rate moves across them; comparisons by adjusted eta squared. The coarser
  split wins when it explains 80% as much (city over neighbourhood).
- **A restatement is not a driver.** A driver that separates an outcome
  perfectly is the outcome — revenue is non-zero exactly when a visitor
  converted.
- **A banding of the measure is not a split of it**, detected from values:
  `Risk_Category` cut from the automation probability, whatever its name.
- **Yes/no columns are outcomes only where the table records what happened.**
  In a priced table, or one with three or more of them, they are features.
- **"Most for the money" needs a price**, a currency measure never summed —
  not a monthly charge per customer.
- **Ordinal scales are splits** (support calls, job level), kept in order.
- **A column of unreadable numbers is neither a measure nor a split.**

Each rule has a test in `tests/reportQuestions.test.mjs`, checked by mutation:
disable it and a test fails.

## What is still missed, and why

15 of 77, in three kinds:

- **Null effects the evidence ranking skips** — department on attrition, plan
  tier on churn, neighbourhood on days on the market, open weights on
  capability. The reader can ask them (phase 3's question card); the
  automatic set asks the questions the rows can answer.
- **Intent no rule can read** — which of two flows is "the" one (units
  shipped or received), whether volume or revenue leads, that the jobs file is
  about education. This is the model's job (phase 4) or the reader's.
- **By design** — `amount` in the filthy file holds two comma conventions and
  stays unread; the feature matrix of the subscription file ("which plans
  include SSO") has no catalogue question yet.

## Changed alongside

- A model-composed deck (a reader's own key) is appended after the questions'
  charts rather than dropped, until phase 4 routes model questions through the
  compiler. The rules are not yet guaranteed for those charts.
- The playbook planner remains reachable as `runAnalysis(rows, { planner:
  'playbook' })` for its own tests; phase 5 removes both.
- `tests/corpus.test.mjs` reads files through the app's ingest chain, not raw
  Papa: the report is about cleaned rows.
- `tests/rowComparison.test.mjs` identifies row-level charts by their
  `rowLevel` flag rather than a title suffix the old planner wrote, and still
  requires named rows ("OpenAI · Pro").
- Known and left for later: the ranking sentence reads an ordered numeric axis
  as a league table ("8 has the highest churn rate of any support calls"), and
  the dashboard's "Some columns are never totalled" banner still describes the
  old planner's fallback to record counts.
