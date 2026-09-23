# Question-first reports

Status: **approved**, 2026-09-23. Replaces the chart-selection core of the
analysis pipeline. Phases 0 (the baseline), 1 (the table model), 2 (question
compilers) and 3 (the question card) are done, and phase 4 (a model's questions)
is built and awaiting its measurement — results in `eval/RESULTS.md`. Phase 5
(cleanup) is done: the playbook planner and the filters behind it are gone.

Decisions taken: questions are asked of the reader as a multiple-choice card;
Pro gets the server model key, Free stays deterministic; Free gets the question
card with catalogue suggestions; saved analyses without questions are shown
as-is with a "choose questions" prompt.

## The problem, stated once

A report is supposed to answer the question the file exists for. Today it
answers "which charts do the column types permit, minus the ones a filter has
learned to reject". Those are different questions, and the gap between them is
where every bad deck comes from.

The subscription comparison (`datasets/ai_subscription_comparison.csv`, no model
key) is the current example. Seven charts, and not one says which plan gives the
most capability for the money:

| chart | what is wrong | class of defect |
|---|---|---|
| USD/point by Product, lead chart | badged "not enough data yet" and still first | ordering ignores evidence |
| USD/point vs Usage Multiplier | multiplier is only comparable *within* a provider; charted across all twelve, "strong evidence" | measure used outside its comparability scope |
| USD/point "by Video Generation" | column has 2 values; sentence says "12 video generations", leader "Fixed throughput · No" | chart labelled by one column, grouped by another |
| Avg USD/point by Audience, donut | a donut of averages; slices are not parts of a whole | part-of-whole drawn over a non-additive aggregate |
| Avg Monthly Price by Provider | averages per-user, per-seat and per-instance prices together | mixed units aggregated |
| Monthly Price by Video Generation | same label/grouping defect as above | as above |
| Record count by Flagship Model | one row per plan; counting rows says nothing | count on an entity table |

Plus one outlier (Cohere's dedicated instance, 178.6 against a next-highest of
6.8) drives three charts, and the page shows three different "averages" of the
same measure (7.1, 16.1, 60.5).

None of these is specific to AI subscriptions. Each is a rule that the
pipeline does not enforce, and the next file will break a different one.

## Why patching does not converge

1. **Generate, then filter.** `analystPlanner` enumerates every chart the schema
   permits; `dropFlatCharts`, `dropTiedRankings`, `limitRecordCounts`,
   `chartSignals`, `critic`, `validitySceptic`, `dataGrain`, `dimensionRoles`
   and others remove what they recognise as bad. Each module's header names the
   dataset that caused it. A filter can only remove a mistake someone has
   already seen, so coverage grows one dataset at a time. 54 of the 125
   commits since 1 September have "fix", "stop" or "never" in their subject.

2. **The tests do not test the shipped path.** `tests/corpus/*.expect.json`
   hands the engine a hand-written brief — the answer a model would give — and
   without one asserts only `withoutBriefMustStillChart: true`. The no-key path,
   which is what most users run, has no quality assertion. The corpus is two
   files, and its expectations are all negative ("must not chart X"); none says
   what the report must answer.

3. **Intent is often not in the file.** "Who on the team gets which plan" is in
   the dataset's README, not its 51 columns. No rule recovers intent in a
   domain it has never seen, and a model can only guess. The only reliable
   source is the person who uploaded it.

4. **The brief's questions are thrown away.** `datasetBrief` already asks the
   model for `questions` and validates them; nothing downstream reads them.

## What "solved" means

It cannot mean "infers the right intent from any CSV with no help". It means
three guarantees, each of which is checkable:

- **G1. Invalid charts cannot be constructed.** A chart is a typed expression
  over a verified table model. Mixed-unit averages, out-of-scope comparisons,
  donuts of means, mislabelled groupings and counts on entity tables fail to
  type-check, so they never exist — on any dataset, including ones nobody has
  tested.
- **G2. Every chart answers a stated question.** The report is built from 3–5
  questions, shown to the reader, chosen by the reader (with suggestions). A
  question the data cannot answer is reported as such, never silently swapped
  for a chart that happens to be buildable.
- **G3. Quality is measured on the shipped paths.** A corpus spanning table
  shapes, run with and without a model, scored on whether each expected
  question was answered, plus a generator of random tables that checks G1 on
  shapes nobody wrote by hand. A regression fails CI.

## Architecture

```
rows ─► 1. Table model ─► 2. Questions ─► 3. Compile ─► 4. Execute & grade ─► 5. Report
        (verified types)   (reader picks)   (type-checked   (unchanged SQL,     (one section
                                              chart specs)    evidence tiers)     per question)
```

### 1. Table model — one verified description of the table

Today the facts about a column are spread across `measureSemantics`,
`measureUnits`, `rateDefinition`, `metricPolarity`, `dataGrain`,
`dimensionRoles` and regexes in `analystPlanner`. They are consolidated into one
object, `lib/tableModel.js`, built once and read by everything after it.

**Grain.** What one row is, derived from the data: `event` (many rows per
entity, a time column), `entity` (a key column unique per row, or near-unique
combination), `entityPeriod` (unique on entity × time — a panel), `response`
(survey: many ordinal columns on a shared scale), `long` (a name column + a
value column holding several quantities). Grain decides which aggregations
mean anything: on an `entity` table, `COUNT(*)` by a category is how many
entities fall in it, not activity, and a sum across entities is rarely the
point.

**Per measure:**

| field | meaning | how it is verified |
|---|---|---|
| `unit` | currency, %, count, score, duration, tokens, unknown | values + name; model may propose, rows must agree |
| `aggregations` | subset of `sum`, `mean`, `median`, `min/max`, `count` | additive only if sum is meaningful at this grain (`measureSemantics` rules, `dataGrain` constancy) |
| `scope` | columns within which values are comparable, e.g. `Local Currency`, `Buyer Unit`, `Provider` | a column whose name or description says "within", a unit/currency column co-varying with it, or a model claim checked by within- vs across-group dispersion |
| `polarity` | higher is better / worse / neutral | from `metricPolarity`, model may propose |
| `robust` | whether mean is safe: false when one row carries > ⅓ of the spread | computed |

**Per dimension:** `role` (entity key, category, flag, ordinal, time, free
text, provenance/URL), cardinality, and whether it is a *driver* (something a
decision could change) or *coverage* (who the data describes) —
`dimensionRoles`' distinction, kept.

The model's brief and unit claims feed this object as proposals; the existing
`accept*` functions stay the gate. Nothing downstream reads a column name.

### 2. Questions — typed, suggested, and chosen by the reader

A question is data, not prose:

```js
{ id, text, intent, measures: [...], by: [...], over?: time, filter?, scope? }
// intent ∈ rank | compare | tradeoff | trend | drivers | distribution | composition | outcome-rate
```

**Where suggestions come from**, merged and deduplicated, best first:

1. **Model** — when the reader brings a key, or on **Pro with the server key**
   (see "Server model on Pro"). The brief's `subject`, `outcomes` and
   `questions`, re-expressed as typed questions and verified against the table
   model like every other claim.
2. **Shape catalogue** — deterministic, no model. Each grain has a small set of
   question templates filled from the table model:
   - `entity` with a cost and a quality measure → *tradeoff*: "Which
     {entity} gives the most {quality} per {cost}?"; *rank* on the outcome;
     *compare* within each scope group.
   - `event` with time and an additive measure → *trend*, *composition* of the
     total by the top driver, *drivers* of change.
   - any table with a binary or bounded outcome → *outcome-rate* by each driver.
   - `response` → mean score per item, *compare* by respondent group.
   - `entityPeriod` / `long` → *trend* per series, never a pooled average
     across series with different units.
3. **Reader's own** — free text, compiled by the existing `questionPlanner`
   offline or `/api/ask` with a model; if it cannot be placed, it says which
   part could not be, as it does today.

**The UX: multiple choice, like a clarifying question.** After cleaning, before
any chart is built, one card:

> **What do you want to know from `ai_subscription_comparison.csv`?**
> One row is a paid AI subscription plan (44 plans, 12 providers).
>
> ☑ Which plan gives the most intelligence per dollar? *(recommended)*
> ☑ How do plans compare on price, within each buyer type?
> ☐ Which providers offer coding agents, SSO and data-retention controls?
> ☐ How do benchmark scores differ by provider?
> ☐ Something else… `[free text]`
>
> `[Build the report]`  ·  `Skip — choose for me`

- Options are multi-select, recommended ones pre-ticked, each with a one-line
  description when the wording alone is ambiguous — the same pattern as a
  clarifying question in a chat.
- "Skip" takes the pre-ticked set, so the one-click path still exists.
- The chosen questions are saved with the analysis and editable later from the
  dashboard ("Change questions"), which re-plans without re-ingesting.
- The subject line ("One row is…") is the grain, stated back so the reader can
  catch a misread table before any chart exists.

### 3. Compile — questions become type-checked chart specs

Each intent has one compiler that turns a question into one or more chart
specs using only the table model. The compilers enforce the invariants at
construction; there is no "build then drop".

| # | invariant | kills |
|---|---|---|
| I1 | A chart's label axis, title and sentence are all derived from the spec's single `groupBy` column | "by Video Generation" grouped by something else |
| I2 | Part-of-whole marks (donut, pie, treemap, stacked-100%) only over `sum` or `count` of an additive measure | donut of averages |
| I3 | A measure is aggregated only within its `scope`; across scopes it is faceted or filtered | averaging per-user with per-instance prices; cross-provider multipliers |
| I4 | One unit per axis; a `long` table's value column is split by its unit column first | GDP averaged with life expectancy |
| I5 | `count` by a dimension is only a finding when grain is `event` or `response` | record count by flagship model |
| I6 | If a measure is not `robust`, rank by median and name the outlier, or chart without it and say so | Cohere dedicated instance driving three charts |
| I7 | A measure is never aggregated over bands of itself (already enforced; moves here) | revenue by revenue band |
| I8 | One definition of "average" per measure per report (row-weighted unless the question says otherwise), used by the KPI and every sentence | 23.9% KPI vs "23.2% average"; 7.1 / 16.1 / 60.5 |
| I9 | Time buckets chosen from span and resolution (hour, day, week, month, year) | 35-day minute series drawn as two months |
| I10 | A chart whose evidence is "not enough data" is never first, and is labelled as a caveat to its question, not a finding | the lead chart above |

The list is expected to grow, but each entry is a *rule over types*, not a
dataset, and each one lands with a generator case (see Evaluation) so it holds
on tables nobody has seen.

**An asked question can have a null answer.** Today `dropFlatCharts` and
`dropTiedRankings` delete a chart whose bars are equal. When the reader asked
"does price differ by region?", "no — within 2% everywhere" is the answer, and
it is shown as one. When the data cannot answer at all (no cost column for a
tradeoff question), the section says why. A question never disappears.

### 4. Execute and grade — mostly unchanged

SQL execution, `chartResolver`, `chartAdvisor` (shape from values), evidence
tiers, `validitySceptic` and narration keep their jobs. `chartSignals` stops
deciding *which* charts exist and only ranks multiple valid answers to the same
question (e.g. which dimension best explains a measure for a *drivers*
question). `critic`'s "what is missing" becomes largely redundant — the
questions are the checklist — and is cut to contradiction detection.

### 5. Report — one section per question

Dashboard, report and deck are ordered by question. Each chart shows the
question it answers above its title. KPIs are the headline answers to the
chosen questions, not the widest measures.

## What is replaced and what is kept

| today | fate |
|---|---|
| `analystPlanner` candidate enumeration and tier playbook (≈2,500 lines) | **replaced** by the intent compilers; its SQL builders and naming are reused |
| `dropFlatCharts`, `dropTiedRankings`, `limitRecordCounts`, `enforceChartDiversity` | **removed**; flat answers are shown, duplicates cannot arise from distinct questions |
| `datasetPurpose` + `datasetBrief` + `deckComposer` (three model passes) | **merged** into one model pass that proposes the table model and typed questions |
| `measureSemantics`, `measureUnits`, `rateDefinition`, `metricPolarity`, `dataGrain`, `dimensionRoles` | **folded into** `tableModel`; logic kept, entry points unified |
| `critic` | reduced to contradiction checks |
| cleaning, SQL engine, `chartResolver`, `chartAdvisor`, evidence tiers, `validitySceptic`, narration | kept |
| `questionPlanner`, `/api/ask` | kept; now also the "Something else" path |

## Server model on Pro

- `canGenerate` becomes: the reader's own key, **or** plan = Pro and a server
  key is configured. BYOK still wins when present.
- Free stays deterministic (shape catalogue only). Note that Free currently has
  `autoAnalysis: false`, i.e. no automatic dashboard at all — see open
  questions.
- What is sent does not change: column names, each column's distinct values or
  range, 20 stride-sampled rows. The privacy copy fixed on 2026-09-23 changes
  again to name this case: "On Pro, … go to our model provider."
- Per-analysis cost is one planning call plus narration; `routeLimits` caps
  apply per account.

## Evaluation

The design is only finished when it is measured.

1. **Corpus to ~30 files across the grains** (the ten eval shapes, the two
   corpus files, the subscription file, plus survey, panel, long, wide-sparse,
   sensor, ledger-with-refunds, multi-currency, per-seat pricing, …). Real where
   possible, generated where a trap needs to be exact.
2. **`expect.json` v2** per file:
   - `grain` — expected.
   - `mustSuggest` — questions the shape catalogue *alone* must offer (tests the
     no-model path).
   - `mustAnswer` — for each expected question, the measure/dimension it must be
     answered with, e.g. `{ intent: "tradeoff", quality: "Intelligence Index",
     cost: "Monthly Price USD", scope: "Buyer Unit" }`.
   - `mustNot` — invariant violations specific to the file.
   Run three ways: no model, recorded model response, reader-chosen questions.
3. **Generator** (`eval/fuzz.mjs`, in CI with fixed seeds): random tables of
   each grain with planted traps — a scoped measure, mixed units, a dominant
   outlier, an entity table, a six-spelling boolean, a long panel. Assert every
   built chart satisfies I1–I10. This is what covers "some other dataset".
4. **Scorecard** in `eval/RESULTS.md`: per file, questions suggested / answered
   / invariant violations, with and without a model. Today's baseline is
   recorded first, before any code changes.

## Phases

| phase | delivers | exit criterion |
|---|---|---|
| 0. Baseline ✅ | expect v2, corpus to ~30, fuzz harness, scorecard of *today's* engine | the scorecard exists and CI runs it — 19/77 answered, 53 violations |
| 1. Table model ✅ | `tableModel.js` with grain, scope, units, aggregations, robustness | grain and scope correct on the whole corpus — 29/29 corpus, 40/40 fuzz |
| 2. Compilers + invariants ✅ | intent compilers, I1–I10 enforced at construction, planner core removed | zero invariant violations on corpus and fuzz; `mustAnswer` passes for the catalogue path — 0 violations, 62/77 answered |
| 3. Question card ✅ | the multiple-choice step, saved questions, "Change questions", sections per question | subscription file: "intelligence per dollar" answered, recommended and pre-ticked with no model — and 69/77 reachable from the card |
| 4. Model pass + Pro server key 🟡 | merged model pass, `canGenerate` change, privacy copy | model path beats catalogue path on the scorecard, never violates an invariant — built; awaits recorded model answers (`eval/record-model.mjs`) |
| 5. Cleanup ✅ | delete superseded filters and passes, update README | no dead planner code; README describes the new pipeline — planner, purpose and compose passes deleted, scorecard unchanged at 62/77 and 69/77 |

Phases 0–2 ship value with no UI change; 3 is the visible change.

## Open questions

1. **Free plan.** Free has no automatic dashboard today. Should Free get the
   question card with catalogue suggestions (deterministic, no model cost)?
   Recommendation: yes — it is the product's core loop and costs nothing to run.
2. **Saved analyses.** Existing saved analyses have no questions. Migrate by
   inferring them from their charts, or show them as-is with a "choose
   questions" prompt? Recommendation: the latter.
3. **How many questions.** 3–5 suggested, up to 3 pre-ticked. Needs a look on a
   real 8-question file to confirm the card does not become a form.
