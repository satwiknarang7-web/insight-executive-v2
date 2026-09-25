/**
 * The changes the assistant can propose, and the check each one passes before
 * the reader is shown it. A model's proposal is data: every column, measure,
 * chart and page it names is looked up here, and anything that does not exist
 * or would draw a chart the data cannot support is dropped with a reason.
 * Nothing in this file changes anything — the panel applies what survives,
 * and only when the reader clicks Apply.
 */
import { allowedViz, grainsFor, VIZ } from '../engine/tiles.js';
import { SAMPLES } from '../samples.js';

export const PAGES = {
  home: '/home',
  dashboard: '/dashboard',
  ask: '/ask',
  explore: '/explore',
  quality: '/quality',
  model: '/model',
  summary: '/summary',
  report: '/report',
  present: '/present',
  library: '/library',
  settings: '/settings',
};

const ROLES = ['time', 'dimension', 'measure', 'id', 'text', 'ignore'];
const AGGS = ['sum', 'avg', 'median'];
const FORMATS = ['number', 'currency', 'percent'];

/** What a model is told it may do — kept beside the checks so they agree. */
export const ACTION_GUIDE = `Actions (JSON objects in "actions"; use only ids and column names from the context):
{"type":"navigate","page":"home|dashboard|ask|explore|quality|model|summary|report|present|library|settings"}
{"type":"load_sample","sample":"retail|churn|messy|campaigns"}   (load a demo dataset: retail sales, subscription churn, messy export, marketing campaigns)
{"type":"add_chart","question":"<plain request, e.g. revenue by region for 2025>"}
{"type":"edit_chart","id":"<chart id>","patch":{"viz":"line|area|column|hbar|stackedColumn|donut|table|scatter|histogram|heatmap","dim":"<column>","series":"<column>|null","grain":"day|week|month|quarter|year","measures":["<measure id>"],"limit":10,"title":"..."}}
{"type":"remove_chart","id":"<chart id>"}
{"type":"move_chart","id":"<chart id>","dir":-1|1}
{"type":"set_filter","field":"<column>","values":["<value>"]}   (or "from"/"to" dates for a date column)
{"type":"remove_filter","field":"<column>"}
{"type":"clear_filters"}
{"type":"add_kpi","measure":"<measure id>"}
{"type":"remove_kpi","id":"<kpi id>"}
{"type":"set_field","field":"<column>","role":"time|dimension|measure|id|text|ignore","agg":"sum|avg|median","format":"number|currency|percent"}
{"type":"add_measure","label":"...","kind":"sum|avg|median|count|distinct|ratio|rate","field":"<column>","per":"<column>|rows","where":{"field":"<column>","value":"<value>"},"format":"number|currency|percent"}
{"type":"transform","phrase":"<one data prep step in plain words, e.g. drop the notes column / keep rows where region is West / add margin = [revenue] - [cost]>"}
{"type":"rebuild"}`;

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'measure';

/** Find a column by name or label, forgiving case and spacing. */
export function findField(fields, name) {
  if (name == null) return null;
  const n = String(name).trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  return fields.find((f) => f.name === name) || fields.find((f) => [f.name, f.label].some((x) => String(x || '').toLowerCase().replace(/[\s_-]+/g, ' ') === n)) || null;
}

function findMeasure(measures, id) {
  if (!id) return null;
  const n = String(id).toLowerCase();
  return measures.find((m) => m.id === id) || measures.find((m) => m.label?.toLowerCase() === n) || null;
}

const allTiles = (board) => (board?.sections || []).flatMap((s) => s.tiles || []);

function findTile(board, id) {
  const tiles = allTiles(board);
  const n = String(id || '').toLowerCase();
  return tiles.find((t) => t.id === id) || tiles.find((t) => t.title?.toLowerCase() === n) || null;
}

const bad = (reason) => ({ ok: false, reason });

/**
 * Check one proposed action against the current table and dashboard.
 * Returns { ok, action, text } with names resolved to real ids, or
 * { ok:false, reason }. `add_chart` and `transform` still need resolving
 * by the engine (see the panel) before they can be shown or applied.
 */
export function checkAction(a, { board, engine, filters = [], dataset } = {}) {
  if (!a || typeof a !== 'object') return bad('Not an action.');
  const fields = engine?.ds?.fields || board?.ds?.fields || [];
  const measures = engine?.measures || board?.measures || [];
  const needBoard = () => (!board ? 'There is no dashboard yet — load a dataset first.' : board.readOnly ? 'This saved dashboard is read-only until its dataset is loaded.' : null);

  switch (a.type) {
    case 'navigate': {
      const path = PAGES[String(a.page || '').replace(/^\//, '').toLowerCase()];
      if (!path) return bad(`There is no "${a.page}" page.`);
      return { ok: true, action: { type: 'navigate', path }, text: `Open the ${path.slice(1)} page` };
    }
    case 'load_sample': {
      const want = String(a.sample || 'retail').toLowerCase();
      const hit = SAMPLES.find((x) => x.key === want) || SAMPLES.find((x) => x.title.toLowerCase().includes(want) || want.includes(x.key)) || null;
      if (!hit) return bad(`There is no "${a.sample}" sample. Samples: ${SAMPLES.map((x) => x.title).join(', ')}.`);
      return { ok: true, action: { type: 'load_sample', key: hit.key }, text: `Load the ${hit.title} sample (${hit.description})${dataset ? ' — this replaces the data now loaded' : ''}` };
    }
    case 'add_chart': {
      const why = needBoard();
      if (why) return bad(why);
      const q = String(a.question || '').trim().slice(0, 300);
      if (!q) return bad('No chart was described.');
      return { ok: true, action: { type: 'add_chart', question: q }, text: `Add a chart: ${q}`, pending: true };
    }
    case 'edit_chart': {
      const why = needBoard();
      if (why) return bad(why);
      const t = findTile(board, a.id);
      if (!t) return bad(`No chart "${a.id}" on the dashboard.`);
      const p = a.patch && typeof a.patch === 'object' ? a.patch : {};
      const patch = {};
      const said = [];
      for (const key of ['dim', 'series', 'x', 'y', 'field']) {
        if (!(key in p)) continue;
        if (p[key] === null && key === 'series') {
          patch.series = null;
          said.push('no series');
          continue;
        }
        const f = findField(fields, p[key]);
        if (!f) return bad(`There is no column "${p[key]}".`);
        patch[key] = f.name;
        said.push(`${key === 'dim' ? 'split by' : key} ${f.label || f.name}`);
      }
      if (Array.isArray(p.measures) && p.measures.length) {
        const ms = p.measures.map((id) => findMeasure(measures, id));
        if (ms.some((m) => !m)) return bad(`Unknown measure in ${p.measures.join(', ')}.`);
        patch.measures = ms.map((m) => m.id);
        said.push(`measure ${ms.map((m) => m.label).join(', ')}`);
      }
      if (p.grain) {
        const time = fields.find((f) => f.name === (patch.dim || t.dim));
        const grains = time ? grainsFor(time) : [];
        if (!grains.includes(p.grain)) return bad(`${p.grain} is not a grain this date supports${grains.length ? ` (try ${grains.join(', ')})` : ''}.`);
        patch.grain = p.grain;
        said.push(`by ${p.grain}`);
      }
      if (p.limit != null) {
        const n = Math.round(Number(p.limit));
        if (!(n >= 1 && n <= 100)) return bad('Top N must be between 1 and 100.');
        patch.limit = n;
        said.push(`top ${n}`);
      }
      if (p.title) {
        patch.title = String(p.title).slice(0, 120);
        said.push(`title "${patch.title}"`);
      }
      const next = { ...t, ...patch };
      const allowed = engine?.ds ? allowedViz(next, engine.ds, measures) : [];
      if (p.viz) {
        if (!allowed.includes(p.viz)) return bad(`A ${VIZ[p.viz] || p.viz} can't show "${t.title}". It can be: ${allowed.map((v) => VIZ[v] || v).join(', ') || 'nothing else'}.`);
        patch.viz = p.viz;
        said.push(`as ${VIZ[p.viz] || p.viz}`);
      } else if (allowed.length && !allowed.includes(t.viz)) patch.viz = allowed[0];
      if (!said.length) return bad('Nothing to change on that chart.');
      return { ok: true, action: { type: 'edit_chart', id: t.id, patch }, text: `Change "${t.title}": ${said.join(', ')}` };
    }
    case 'remove_chart': {
      const why = needBoard();
      if (why) return bad(why);
      const t = findTile(board, a.id);
      if (!t) return bad(`No chart "${a.id}" on the dashboard.`);
      return { ok: true, action: { type: 'remove_chart', id: t.id }, text: `Remove "${t.title}"` };
    }
    case 'move_chart': {
      const why = needBoard();
      if (why) return bad(why);
      const t = findTile(board, a.id);
      if (!t) return bad(`No chart "${a.id}" on the dashboard.`);
      const dir = Number(a.dir) < 0 ? -1 : 1;
      return { ok: true, action: { type: 'move_chart', id: t.id, dir }, text: `Move "${t.title}" ${dir < 0 ? 'up' : 'down'}` };
    }
    case 'set_filter': {
      const why = needBoard();
      if (why) return bad(why);
      const f = findField(fields, a.field);
      if (!f) return bad(`There is no column "${a.field}".`);
      if (f.role === 'time') {
        if (!a.from && !a.to) return bad('A date filter needs a from or to date.');
        const d = (x) => (x && !Number.isNaN(Date.parse(x)) ? String(x).slice(0, 10) : null);
        const filter = { field: f.name, from: d(a.from), to: d(a.to) };
        return { ok: true, action: { type: 'set_filter', filter }, text: `Filter ${f.label || f.name} ${filter.from ? `from ${filter.from}` : ''} ${filter.to ? `to ${filter.to}` : ''}`.trim() };
      }
      const wanted = (Array.isArray(a.values) ? a.values : [a.values]).filter((v) => v != null).map(String);
      if (!wanted.length) return bad('No values to filter on.');
      const known = (f.top || []).map((t) => String(Array.isArray(t) ? t[0] : t));
      const values = wanted.map((v) => known.find((k) => k.toLowerCase() === v.toLowerCase()) || v);
      return { ok: true, action: { type: 'set_filter', filter: { field: f.name, values } }, text: `Filter ${f.label || f.name} to ${values.join(', ')}`, checkValues: known.length < (f.distinct || 0) || values.some((v) => !known.includes(v)) };
    }
    case 'remove_filter': {
      const f = findField(fields, a.field);
      if (!f || !filters.some((x) => x.field === f.name)) return bad(`No filter on "${a.field}".`);
      return { ok: true, action: { type: 'remove_filter', field: f.name }, text: `Remove the ${f.label || f.name} filter` };
    }
    case 'clear_filters':
      if (!filters.length) return bad('No filters are applied.');
      return { ok: true, action: { type: 'clear_filters' }, text: 'Clear all filters' };
    case 'add_kpi': {
      const why = needBoard();
      if (why) return bad(why);
      const m = findMeasure(measures, a.measure);
      if (!m) return bad(`There is no measure "${a.measure}".`);
      if (m.local) return bad(`${m.label} is in each row's own currency, so it can't be totalled into one number.`);
      return { ok: true, action: { type: 'add_kpi', measure: m.id }, text: `Add a KPI card for ${m.label}` };
    }
    case 'remove_kpi': {
      const why = needBoard();
      if (why) return bad(why);
      const n = String(a.id || '').toLowerCase();
      const k = (board.kpis || []).find((x) => x.id === a.id || x.title?.toLowerCase() === n);
      if (!k) return bad(`No KPI "${a.id}".`);
      return { ok: true, action: { type: 'remove_kpi', id: k.id }, text: `Remove the ${k.title} KPI` };
    }
    case 'set_field': {
      const why = needBoard();
      if (why) return bad(why);
      const f = findField(fields, a.field);
      if (!f) return bad(`There is no column "${a.field}".`);
      const patch = {};
      if (a.role != null) {
        if (!ROLES.includes(a.role)) return bad(`"${a.role}" is not a column type.`);
        if (a.role === 'measure' && f.kind !== 'number') return bad(`${f.label || f.name} holds text, so it can't be read as a number.`);
        if (a.role === 'time' && f.kind !== 'date' && !(f.kind === 'number' && f.min >= 1900 && f.max <= 2100)) return bad(`${f.label || f.name} doesn't hold dates.`);
        patch.role = a.role;
      }
      if (a.agg != null) {
        if (!AGGS.includes(a.agg)) return bad(`"${a.agg}" is not a way to combine numbers.`);
        patch.agg = a.agg;
      }
      if (a.format != null) {
        if (!FORMATS.includes(a.format)) return bad(`"${a.format}" is not a format.`);
        patch.format = a.format;
      }
      if (!Object.keys(patch).length) return bad('Nothing to change on that column.');
      const words = [patch.role && `read as ${patch.role}`, patch.agg && `combined by ${patch.agg}`, patch.format && `shown as ${patch.format}`].filter(Boolean);
      return { ok: true, action: { type: 'set_field', field: f.name, patch }, text: `${f.label || f.name}: ${words.join(', ')} (the dashboard is rebuilt)` };
    }
    case 'add_measure': {
      const why = needBoard();
      if (why) return bad(why);
      const kind = String(a.kind || '');
      const format = FORMATS.includes(a.format) ? a.format : kind === 'rate' ? 'percent' : 'number';
      const f = kind === 'count' || kind === 'rate' ? null : findField(fields, a.field);
      if (kind !== 'count' && kind !== 'rate' && !f) return bad(`There is no column "${a.field}".`);
      if (['sum', 'avg', 'median', 'ratio'].includes(kind) && f.kind !== 'number') return bad(`${f.label || f.name} is not a number.`);
      let where;
      if (a.where?.field) {
        const wf = findField(fields, a.where.field);
        if (!wf) return bad(`There is no column "${a.where.field}".`);
        where = { field: wf.name, value: String(a.where.value ?? '') };
      }
      const label = String(a.label || '').trim().slice(0, 80) || `${kind} ${f?.label || ''}`.trim();
      const base = { label, format, scale: 1, currency: '', polarity: 0, importance: 99, id: `custom:${slug(label)}` };
      const filter = where ? [{ field: where.field, values: [where.value] }] : undefined;
      let m;
      if (kind === 'count') m = { ...base, type: 'count', ...(filter ? { where: filter } : {}), additive: true };
      else if (kind === 'distinct') m = { ...base, type: 'distinct', field: f.name, additive: false };
      else if (kind === 'rate') {
        if (!where) return bad('A rate needs a condition, e.g. status = Cancelled.');
        m = { ...base, type: 'rate', event: { field: where.field, value: where.value }, format: 'percent', additive: false };
      } else if (kind === 'ratio') {
        const per = a.per === 'rows' || !a.per ? null : findField(fields, a.per);
        if (a.per && a.per !== 'rows' && !per) return bad(`There is no column "${a.per}".`);
        const num = { id: `sum:${f.name}`, type: 'agg', field: f.name, agg: 'sum', where: filter };
        const den = per ? { id: `sum:${per.name}`, type: 'agg', field: per.name, agg: 'sum' } : { id: 'count', type: 'count' };
        m = { ...base, type: 'ratio', num, den, additive: false };
      } else if (AGGS.includes(kind)) m = { ...base, type: 'agg', field: f.name, agg: kind, where: filter, additive: kind === 'sum' };
      else return bad(`"${kind}" is not a kind of measure.`);
      return { ok: true, action: { type: 'add_measure', measure: m }, text: `Add the measure "${label}"` };
    }
    case 'transform': {
      if (!dataset) return bad('Load a dataset first.');
      const phrase = String(a.phrase || '').trim().slice(0, 300);
      if (!phrase) return bad('No data prep step was described.');
      return { ok: true, action: { type: 'transform', phrase }, text: `Data prep: ${phrase}`, pending: true };
    }
    case 'rebuild': {
      if (!dataset) return bad('Load a dataset first.');
      return { ok: true, action: { type: 'rebuild' }, text: 'Rebuild the dashboard from scratch' };
    }
    default:
      return bad(`"${a.type}" is not something the assistant can do.`);
  }
}

