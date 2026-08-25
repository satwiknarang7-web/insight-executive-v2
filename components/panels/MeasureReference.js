'use client';

/**
 * What you can measure, and what you can say — beside the box you type into.
 *
 * Writing a measure means knowing two things this page was not telling you: the
 * columns this dataset actually has, and the operations the parser understands.
 * Without them the honest workflow was to go to Explore, read the column names,
 * come back, and guess at phrasing — which is exactly what people were doing.
 *
 * Columns are grouped by the role the profiler already assigned them, because
 * the role is what decides where a column can go: a measure is something to sum,
 * a dimension is something to break it out by, and an identifier is neither.
 * Clicking any of them types it, so a name never has to be transcribed by hand.
 */
import { useMemo, useState } from 'react';
import { Calendar, Fingerprint, Hash, Sigma, Type } from 'lucide-react';

/** The shapes `parseMeasurePhrase` recognises, in the words it recognises. */
const OPERATIONS = [
  { verb: 'total / sum', example: 'total revenue', note: 'adds a column up' },
  { verb: 'average / mean', example: 'average order value', note: 'the mean of a column' },
  { verb: 'count', example: 'count of orders', note: 'how many rows' },
  { verb: 'distinct count', example: 'number of distinct customers', note: 'unique values only' },
  { verb: 'minimum / maximum', example: 'maximum discount', note: 'the smallest or largest' },
  { verb: 'ratio / per', example: 'revenue per customer', note: 'one divided by another' },
  { verb: 'percentage of', example: 'profit as a percentage of revenue', note: 'a share, formatted as %' },
  { verb: 'difference', example: 'revenue minus cost', note: 'one column less another' },
  { verb: 'filtered', example: 'total revenue where region is West', note: 'add “where …” to narrow it' },
];

const ROLE_META = {
  measure: { label: 'Measures — things to add up', icon: Hash, tone: 'text-accent-400' },
  dimension: { label: 'Dimensions — things to group by', icon: Type, tone: 'text-white/50' },
  time: { label: 'Dates', icon: Calendar, tone: 'text-white/50' },
  identifier: { label: 'Identifiers — count these, do not sum them', icon: Fingerprint, tone: 'text-amber-400' },
};

const ROLE_ORDER = ['measure', 'dimension', 'time', 'identifier'];

export default function MeasureReference({ dataset, onInsert }) {
  const [tab, setTab] = useState('columns');

  const grouped = useMemo(() => {
    const profile = dataset?.profile?.columns || {};
    const out = {};
    for (const name of dataset?.columns || []) {
      const role = profile[name]?.role || 'dimension';
      (out[role] ||= []).push(name);
    }
    return out;
  }, [dataset]);

  const total = (dataset?.columns || []).length;
  if (!total) return null;

  return (
    <div className="card flex h-full flex-col p-5">
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setTab('columns')}
          className={`rounded-lg px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.15em] transition-colors ${
            tab === 'columns' ? 'bg-accent-500/12 text-accent-300' : 'text-white/40 hover:text-white/70'
          }`}
        >
          Columns ({total})
        </button>
        <button
          type="button"
          onClick={() => setTab('operations')}
          className={`rounded-lg px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.15em] transition-colors ${
            tab === 'operations' ? 'bg-accent-500/12 text-accent-300' : 'text-white/40 hover:text-white/70'
          }`}
        >
          What you can say
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {tab === 'columns' ? (
          <div className="flex flex-col gap-4">
            {ROLE_ORDER.filter((role) => grouped[role]?.length).map((role) => {
              const meta = ROLE_META[role];
              const Icon = meta.icon;
              return (
                <div key={role}>
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <Icon size={11} className={meta.tone} />
                    <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/35">
                      {meta.label}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {grouped[role].map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => onInsert?.(name)}
                        title={`Add “${name}” to what you are typing`}
                        className="max-w-full truncate rounded-md border border-white/8 bg-white/[0.03] px-2 py-1 text-[11px] font-bold text-white/70 transition-colors hover:border-accent-500/40 hover:bg-accent-500/10 hover:text-accent-200"
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            <p className="text-[11px] leading-relaxed text-white/30">
              Click a column to drop its name into the box. Names are matched loosely, so
              &ldquo;revenue&rdquo; finds <code className="text-white/50">Total_Revenue</code>.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {OPERATIONS.map((op) => (
              <button
                key={op.verb}
                type="button"
                onClick={() => onInsert?.(op.example, { replace: true })}
                className="group rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2 text-left transition-colors hover:border-accent-500/30 hover:bg-accent-500/[0.06]"
              >
                <div className="flex items-center gap-2">
                  <Sigma size={10} className="shrink-0 text-accent-400/70" />
                  <span className="text-[11px] font-black uppercase tracking-[0.12em] text-white/55">
                    {op.verb}
                  </span>
                </div>
                <div className="mt-1 text-[12px] font-bold text-white/80 group-hover:text-accent-200">
                  “{op.example}”
                </div>
                <div className="text-[11px] text-white/35">{op.note}</div>
              </button>
            ))}
            <p className="text-[11px] leading-relaxed text-white/30">
              Click an example to try it. Anything the parser does not recognise is sent to the language
              model, which returns a formula you can read before saving.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
