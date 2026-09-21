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
