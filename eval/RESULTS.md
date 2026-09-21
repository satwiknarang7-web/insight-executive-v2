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
