'use client';

import { ShieldCheck, EyeOff, AlertTriangle, Wand2, Trash2, Database, HelpCircle, Hash, Calendar, Type, Fingerprint, Eraser, Scale, Rows3, Sigma } from 'lucide-react';
import { useDataset } from '../../../lib/store/DatasetProvider';
import PageFrame from '../../../components/shell/PageFrame';
import DatasetNotices from '../../../components/panels/DatasetNotices';
import { formatSql } from '../../../lib/sqlFormat';
import { REASON_TEXT, summarizeConfidence } from '../../../lib/cellConfidence';

/**
 * The profiler's own words, in everybody else's.
 *
 * "Dimension" and "Measure" are what this table has always said, and they are
 * the right words in a data warehouse. On the one page written for somebody
 * who does not work in one, they are two columns of vocabulary a reader has to
 * look up before the table tells them anything. The distinction survives; only
 * the naming changes.
 */
const ROLE_WORDS = {
  identifier: 'Names each row',
  dimension: 'Groups the rows',
  // Not "gets totalled": the role only says the column holds numbers. Whether
  // those numbers may be added up is a separate question the planner answers
  // per column, and a satisfaction score is exactly the case where the answer
  // is no.
  measure: 'A number to compare',
  time: 'Marks when',
};

const ROLE_ICONS = { identifier: Fingerprint, dimension: Type, measure: Hash, time: Calendar };

const TYPE_WORDS = {
  string: 'Text',
  number: 'Numbers',
  date: 'Dates',
  boolean: 'Yes / no',
};

export default function QualityPage() {
  const { dataset } = useDataset();
  if (!dataset) return null;

  const m = dataset.metrics;
  const integrity = m.totalCells > 0 ? ((m.totalCells - m.totalAnomalies) / m.totalCells) * 100 : 100;
  const good = integrity >= 90;

  const columns = dataset.columns;
  const profile = dataset.profile?.columns || {};

  // Columns whose commas were decided one way rather than assumed. Reported
  // because the two readings differ by a factor of a hundred, and a reader who
  // knows their own file is the only one who can say the call was right.
  const decimalComma = m.decimalCommaColumns || [];
  const ambiguousComma = m.ambiguousCommaColumns || [];

  // Cells the cleaner had to choose a reading for, as opposed to cells it
  // merely reformatted. The distinction is the whole point of the section
  // below: a flag on every changed cell would be a flag on nearly every cell.
  const guessed = summarizeConfidence(m.confidence, dataset.rowCount);

  const notices = dataset.notices || [];

  // `outliersCount` counts cells — it is incremented inside a per-column loop —
  // so calling it a row count overstated how much of the table is unusual. The
  // true row count is only present on datasets cleaned by a build that computes
  // it, hence the fallback rather than an assumption.
  const outlierRows = m.outlierRows ?? null;

  // The fence moved onto a log scale for skewed columns, so the plain sentence
  // about standard deviations from the mean is only true of the rest.
  const outlierMethod = m.outlierMethod ?? null;

  // A row Papa could not fit to the header. Counting it as a blank — which is
  // all this page could do before — described a misaligned file and a sparse
  // one with the same number, and only one of them is the reader's problem.
  const malformedRows = m.malformedRows || 0;
  const malformedSamples = m.malformedSamples || [];
  const nullsFromShortRows = m.nullsFromShortRows || 0;

  return (
    <PageFrame title="Cleaning report" subtitle={`What was changed on the way in, for ${dataset.fileName}`}>
      {/* What the ingest decided for you. This is the page that owes the reader
          the full list, so it is shown here undismissed and in full. */}
      {notices.length > 0 && (
        <section className="mb-6">
          <div className="mb-3 flex items-center gap-3">
            <AlertTriangle size={14} className="text-amber-400" />
            <h2 className="label">
              Notices ({notices.length})
            </h2>
            <div className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
          </div>
          <DatasetNotices notices={notices} dismissible={false} />
        </section>
      )}

      {/*
        * The verdict first, in a sentence, and the number as its evidence.
        *
        * This led with "Integrity score — 99.3%", which is a number with
        * nothing to compare it to: a reader who does not already know what
        * counts as a good score cannot tell whether they have a problem, and
        * the sentence explaining it used "statistically extreme" and "type
        * coercion" to do so. Most people opening this page are not going to
        * translate that, and the thing they came to find out is whether their
        * file is all right.
        */}
      <section className={`card mb-6 overflow-hidden p-6 md:p-7 ${good ? '' : 'border-amber-400/30'}`}>
        <div className="flex flex-col gap-6 md:flex-row md:items-center">
          <Gauge value={integrity} good={good} />
          <div className="min-w-0 flex-1">
            <div className="label">Data health</div>
            <div className={`display mt-1.5 text-[26px] leading-tight md:text-[30px] ${good ? 'text-emerald-400' : 'text-amber-400'}`}>
              {good ? 'This file is in good shape.' : 'Mostly fine — some of it needs a look.'}
            </div>
            <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-white/65">
              <strong className="font-semibold text-white/90">{integrity.toFixed(1)}%</strong> of the cells were filled in and
              within a normal range for their column.{' '}
              {good ? 'Nothing here needs your attention before reading the dashboard.' : 'The sections below say exactly which columns are involved.'}
            </p>
            <p className="mt-3 max-w-xl text-[12.5px] leading-relaxed text-white/40">
              Tidying a value up does not count against this: reading <span className="font-semibold text-white/65">$1,200</span> as
              the number 1200 is recognising what it always was.
            </p>
          </div>
        </div>
      </section>

      {/* Ingestion metrics */}
      <section className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {/*
          * Named for what happened, not for the operation that did it.
          *
          * "PII redacted" and "Values coerced" are the words an engineer uses
          * about this step. A reader who does not know that PII means personal
          * information, or that coercion means reading "$1,200" as a number,
          * learns nothing from a tile counting them.
          */}
        <Metric icon={Database} label="Rows in your file" value={m.totalRows} />
        <Metric icon={ShieldCheck} label="Rows we could use" value={m.cleanRows ?? dataset.rowCount} tone="emerald" />
        <Metric icon={EyeOff} label="Personal details hidden" value={m.redactedPII} tone="accent" />
        <Metric icon={Wand2} label="Numbers and dates recognised" value={m.typesCoerced} />
        <Metric icon={AlertTriangle} label="Cells left empty" value={m.nullsFound} tone="amber" />
        <Metric icon={Trash2} label="Blank rows removed" value={m.droppedRows} tone="rose" />
      </section>

      {/* What was done */}
      <section className="card mb-8 p-6">
        <div className="label mb-4">What we changed on the way in</div>
        <ul className="grid gap-3 md:grid-cols-2">
          <Bullet icon={EyeOff} title="Hid personal details" count={m.redactedPII}>
            Anything that looked like an email address, a phone number, a social security number or a
            card number was replaced with a placeholder before anything else happened, so none of it
            reached the charts.{' '}
            {m.redactedPII > 0
              ? `${m.redactedPII.toLocaleString()} ${m.redactedPII === 1 ? 'cell was' : 'cells were'} covered up this way.`
              : 'Nothing in this file looked like personal information.'}
          </Bullet>
          <Bullet icon={Sigma} title="Recognised numbers and dates" count={m.typesCoerced}>
            Values written for people to read — <span className="text-white/75">$1,200</span>,{' '}
            <span className="text-white/75">45%</span>, <span className="text-white/75">(300)</span> for
            minus three hundred — were read as the numbers they stand for, and dates written in any of the
            usual ways were all put in one order.{' '}
            {m.typesCoerced > 0
              ? `${m.typesCoerced.toLocaleString()} ${m.typesCoerced === 1 ? 'value' : 'values'} were read this way. Nothing was rounded or altered.`
              : 'Every value in this file was already a plain number, date or word.'}
          </Bullet>
          {decimalComma.length > 0 && (
            <Bullet icon={Hash} title="Read commas as decimal points" count={decimalComma.length} unit="column">
              {listColumns(decimalComma)} {decimalComma.length === 1 ? 'is written' : 'are written'} in the
              European convention, where the comma is the decimal point — so{' '}
              <code className="rounded bg-white/6 px-1 py-0.5 font-mono text-[11px]">900,50</code> was read as
              900.5, not 90,050. The whole column decides this together; no cell is guessed at on its own.
            </Bullet>
          )}
          {ambiguousComma.length > 0 && (
            <Bullet icon={Type} title="Left ambiguous numbers as text" count={ambiguousComma.length} unit="column" warn>
              {listColumns(ambiguousComma)} {ambiguousComma.length === 1 ? 'contains' : 'contain'} commas
              used both ways — as a thousands separator in some rows and as a decimal point in others. No
              reading makes every value true, so they were kept as text rather than half of them being
              wrong. Fix the source column to include them in the analysis.
            </Bullet>
          )}
          <Bullet icon={Eraser} title="Treated empty markers as empty" count={m.nullsFound} unit="blank">
            Cells holding <span className="text-white/75">N/A</span>,{' '}
            <span className="text-white/75">null</span> or a lone{' '}
            <span className="text-white/75">-</span> are ways of writing &ldquo;nothing here&rdquo;, so they
            are now counted as nothing rather than as a value. That keeps them out of averages, which they
            would otherwise drag down.
          </Bullet>
          {malformedRows > 0 && (
            <Bullet icon={Rows3} title="Rows that did not match the header" count={malformedRows} unit="row" warn>
              {`${malformedRows.toLocaleString()} ${malformedRows === 1 ? 'row' : 'rows'} carried a different number of fields than the header`}
              {malformedSamples.length > 0 ? ` — ${describeMalformed(malformedSamples, dataset.multiTable)}` : ''}.{' '}
              {nullsFromShortRows > 0
                ? `${nullsFromShortRows.toLocaleString()} of the blanks counted above come from those rows rather than from empty cells. `
                : ''}
              A stray unquoted comma is the usual cause.
            </Bullet>
          )}
          <Bullet icon={Scale} title="Marked unusually large or small values" count={m.outliersCount} unit="value" warn={m.outliersCount > 0}>
            {m.outliersCount === 0
              ? 'Every value sits within the normal range for its column — nothing stood out as unusual.'
              : `${m.outliersCount.toLocaleString()} ${m.outliersCount === 1 ? 'value is' : 'values are'} far
                 from the typical value for their column${
                   outlierRows === null
                     ? ''
                     : `, across ${outlierRows.toLocaleString()} ${outlierRows === 1 ? 'row' : 'rows'}`
                 }. They may be real, or they may be typing mistakes — only you can say.`}
            {m.outliersCount > 0 && (outlierMethod === 'log-z' || outlierMethod === 'mixed')
              ? ' Columns with a few very large values are judged on a sliding scale, so one big number does not make the next one look normal.'
              : ''}{' '}
            {m.outliersCount > 0
              ? 'Nothing was deleted. They are kept, counted, and shown in red on the Data table page so you can check them.'
              : ''}
          </Bullet>
        </ul>
      </section>

      {/* Cells that were a judgement rather than a reading */}
      {guessed.columns.length > 0 && (
        <section className="card mb-8 p-6">
          <div className="mb-1 flex items-center gap-2">
            <HelpCircle size={14} className="text-amber-400" />
            <span className="label">Cells we had to make a judgement call on</span>
          </div>
          <p className="mb-5 max-w-3xl text-[14px] leading-relaxed text-white/65">
            These are not the values recognised above. Reading{' '}
            <span className="text-white/80">1234</span> as a number is not a judgement — there is only
            one thing it can mean. These are cells where two readings were equally reasonable and one had
            to be picked. Anything the dashboard says about a column listed here is marked as less
            certain because of it, and a column that is mostly guesswork cannot support a confident
            claim however tidy the arithmetic looks.
          </p>

          <ul className="flex flex-col gap-2">
            {guessed.columns.map((entry) => {
              const pct = Math.round(entry.share * 100);
              return (
                <li key={entry.column} className="rounded-xl border border-white/6 bg-white/[0.02] p-4">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-mono text-[13px] font-bold text-white/85">{entry.column}</span>
                    <span className="text-[11px] tabular-nums text-amber-300/80">
                      {entry.count.toLocaleString()} {entry.count === 1 ? 'cell' : 'cells'}
                    </span>
                    <span className="ml-auto text-[11px] font-black tabular-nums text-white/45">
                      {pct < 1 ? '<1' : pct}%
                    </span>
                  </div>

                  {/* The bar is the share, not a score: full means the whole
                      column was chosen rather than read. */}
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/6">
                    <div
                      className="h-full rounded-full bg-amber-400/60"
                      style={{ width: `${Math.max(2, Math.min(100, entry.share * 100))}%` }}
                    />
                  </div>

                  <ul className="mt-2.5 flex flex-col gap-1">
                    {Object.entries(entry.reasons).map(([reason, n]) => (
                      <li key={reason} className="text-[12px] leading-relaxed text-white/40">
                        <span className="tabular-nums text-white/55">{n.toLocaleString()}</span>{' '}
                        {REASON_TEXT[reason] || reason}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Column detail */}
      <section className="card mb-8 overflow-hidden">
        <div className="border-b border-white/7 px-5 py-3">
          <span className="label">Column health</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-white/[0.02] text-[10px] font-semibold uppercase tracking-[0.08em] text-white/45">
                <th className="px-4 py-2.5">Column</th>
                <th className="px-4 py-2.5">How it is used</th>
                <th className="px-4 py-2.5">What it holds</th>
                <th className="px-4 py-2.5 text-right">Different values</th>
                <th className="px-4 py-2.5">Filled</th>
                <th className="px-4 py-2.5 text-right">Hidden</th>
              </tr>
            </thead>
            <tbody>
              {columns.map((col) => {
                const p = profile[col] || {};
                const stat = m.columnStats?.[col] || {};
                const nullPct = dataset.rowCount ? ((p.nullCount || 0) / dataset.rowCount) * 100 : 0;
                return (
                  <tr key={col} className="border-t border-white/5 transition-colors hover:bg-white/[0.03]">
                    <td className="max-w-[240px] px-4 py-3" title={col}>
                      <span className="flex items-center gap-2">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${nullPct > 10 || stat.piiCount ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                        {(() => {
                          const RoleIcon = ROLE_ICONS[p.role] || Type;
                          return <RoleIcon size={12} className="shrink-0 text-accent-400/70" />;
                        })()}
                        <span className="truncate font-semibold text-white/85">{col}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-white/60">{ROLE_WORDS[p.role] || p.role || '—'}</td>
                    <td className="px-4 py-2.5 text-white/45">
                      {p.role === 'time' && p.type === 'string'
                        ? 'Dates'
                        : TYPE_WORDS[p.type] || p.type || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-white/55">
                      {(p.distinctCount || 0).toLocaleString()}
                      {p.distinctCapped ? '+' : ''}
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-white/8">
                          <span className={`block h-full rounded-full ${nullPct > 10 ? 'bg-amber-400/80' : 'bg-emerald-400/80'}`} style={{ width: `${100 - nullPct}%` }} />
                        </span>
                        <span className={`font-mono tabular-nums ${nullPct > 10 ? 'text-amber-400' : 'text-white/55'}`}>{(100 - nullPct).toFixed(nullPct > 0 && nullPct < 1 ? 1 : 0)}%</span>
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-white/45">
                      {stat.piiCount ? stat.piiCount.toLocaleString() : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

    </PageFrame>
  );
}

function Metric({ icon: Icon, label, value, tone }) {
  const colors = {
    emerald: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-400',
    accent: 'border-accent-400/25 bg-accent-400/10 text-accent-400',
    amber: 'border-amber-400/25 bg-amber-400/10 text-amber-400',
    rose: 'border-rose-400/25 bg-rose-400/10 text-rose-400',
  };
  // Zero reads as "none": on a clean file most of these are zero, and the
  // zeros are the good news.
  const n = value || 0;
  return (
    <div className="card p-4">
      <span className={`flex h-8 w-8 items-center justify-center rounded-lg border ${colors[tone] || 'border-white/10 bg-white/[0.04] text-white/50'}`}>
        <Icon size={15} />
      </span>
      <div className={`figure mt-3 ${n === 0 ? 'text-[18px] font-semibold text-white/50' : 'text-[24px] font-semibold text-white/95'}`}>
        {n === 0 ? 'None' : n.toLocaleString()}
      </div>
      <div className="mt-1 text-[11.5px] leading-tight text-white/55">{label}</div>
    </div>
  );
}

/** The share of healthy cells as a ring. */
function Gauge({ value, good }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="relative h-36 w-36 shrink-0" role="img" aria-label={`${v.toFixed(1)}% of cells healthy`}>
      <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
        <circle cx="64" cy="64" r={r} fill="none" stroke="currentColor" strokeWidth="10" className="text-white/10" />
        <circle cx="64" cy="64" r={r} fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} className={good ? 'text-emerald-400' : 'text-amber-400'} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="figure text-[28px] font-semibold text-white/95">{v.toFixed(1)}<span className="text-[15px] text-white/50">%</span></span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/45">healthy</span>
      </div>
    </div>
  );
}

/** "Turnover", "Turnover and Cost", "Turnover, Cost and 3 more". */
function listColumns(names) {
  const shown = names.slice(0, 2).map((n) => `“${n}”`);
  const rest = names.length - shown.length;
  if (rest > 0) return `${shown.join(', ')} and ${rest} more`;
  return shown.length === 2 ? `${shown[0]} and ${shown[1]}` : shown[0];
}

// Name the first few offending rows. A count alone tells a reader something is
// wrong; a row number tells them where to look, which is the whole point of
// counting these apart from blanks.
function describeMalformed(samples, multiTable) {
  const shown = samples.slice(0, 3).map((s) => {
    // The table only earns a mention when there is more than one of them.
    const where = multiTable && s.table ? `${s.table} row ${s.row}` : `row ${s.row}`;
    return `${where} has ${s.kind === 'TooManyFields' ? 'more' : 'fewer'} fields than the header`;
  });
  const rest = samples.length > shown.length ? `, and ${samples.length - shown.length} more` : '';
  return shown.join('; ') + rest;
}

function Bullet({ icon: Icon = Wand2, title, count = null, unit = 'change', warn = false, children }) {
  const n = count || 0;
  const tag = count === null ? null : n === 0 ? 'Nothing needed' : `${n.toLocaleString()} ${unit}${n === 1 ? '' : 's'}`;
  return (
    <li className="flex gap-3 rounded-xl border border-white/8 bg-white/[0.02] p-4 transition-colors hover:border-accent-400/30">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${warn && n ? 'border-amber-400/25 bg-amber-400/10 text-amber-400' : 'border-accent-400/25 bg-accent-400/10 text-accent-400'}`}>
        <Icon size={15} />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-semibold text-white/90">{title}</span>
          {tag && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${n === 0 ? 'bg-white/[0.06] text-white/45' : warn ? 'bg-amber-400/12 text-amber-300' : 'bg-accent-400/12 text-accent-300'}`}>{tag}</span>
          )}
        </div>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/50">{children}</p>
      </div>
    </li>
  );
}
