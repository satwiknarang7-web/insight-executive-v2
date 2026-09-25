/**
 * What the assistant knows, and how it finds the part a question needs.
 *
 * Two kinds of passage: the help pages below (how the app works), written
 * once; and passages about the reader's own table and dashboard, written
 * fresh from state every time a question is asked. Both go into one BM25
 * index, and the top passages are what a model sees — or, with no model,
 * what the assistant answers from. Nothing leaves the browser for retrieval.
 */

export const HELP = [
  { id: 'help:upload', title: 'Loading data', page: '/home', text: 'Upload or import data on the Home page: drag a CSV, TSV, Excel, JSON or Parquet file onto the drop zone, paste a link, connect a database, read a table from a photo or PDF, or pick a sample dataset (Retail sales, Subscription churn, Messy export, Marketing campaigns) — or ask the assistant to load one. The file is read in your browser. After loading, the dashboard is built at once.' },
  { id: 'help:dashboard', title: 'The dashboard', page: '/dashboard', text: 'The dashboard is built automatically from your data: headline KPI cards with change versus the previous period and a sparkline, then sections of charts (overview, trend, mix, drivers, breakdown, compare, relationships, distribution, detail). Each chart has a caption with the numbers behind what it shows. Click a bar or slice to filter the whole dashboard by that value.' },
  { id: 'help:filters', title: 'Filters', page: '/dashboard', text: 'Filters sit above the charts. Filter by date range or by the values of a category column. Filters apply to every chart and KPI. Clear them with Clear filters.' },
  { id: 'help:edit', title: 'Editing charts', page: '/dashboard', text: 'Click Edit on the dashboard to enter editing mode. Each chart then has Edit chart, move up, move down, resize and remove controls. The chart editor lets you change the measure, the column it is split by, the time grain, the chart type, top N, and filters. Only chart types that fit the data are offered. Add chart adds a new chart. KPIs can be removed or added in editing mode.' },
  { id: 'help:fields', title: 'Fields and measures', page: '/dashboard', text: 'Fields & measures shows how each column was read: date, category, identifier, number that adds up, number to average, text, or ignored, and its format (number, money, percent). Change one and the dashboard is rebuilt. You can also build your own measure: a count, a sum or average of a column, a distinct count, a ratio of two measures, or a rate of rows matching a condition.' },
  { id: 'help:ask', title: 'Ask a question', page: '/ask', text: 'The Ask page turns a plain question such as "revenue by region", "monthly orders" or "top 10 products by sales" into a chart with a sentence on what it shows. Any answer can be added to the dashboard. There is also a SQL console for querying the table directly.' },
  { id: 'help:explore', title: 'Explore and data prep', page: '/explore', text: 'Explore shows the rows of the table with search and sorting, and the transform panel for shaping data: rename, drop or keep columns, add calculated columns, filter rows, split or combine columns, change types, fill blanks, replace values, remove duplicates, band numbers, extract date parts, group and pivot. Steps are applied in order and can be removed. Changing the data rebuilds the dashboard.' },
  { id: 'help:quality', title: 'Data quality', page: '/quality', text: 'Quality shows what the cleaner did to the data: types read, values fixed, blanks, duplicates and suspect cells, in plain words.' },
  { id: 'help:model', title: 'Data model', page: '/model', text: 'When several tables or sheets are loaded, the Model page shows which is the main (fact) table and how the others join to it. You can change the main table and the joins.' },
  { id: 'help:summary', title: 'Summary', page: '/summary', text: 'Summary is the executive read of the dashboard: a headline, the key findings with their numbers, and the KPIs.' },
  { id: 'help:report', title: 'Report and exports', page: '/report', text: 'Report is the dashboard written out as a document. Print it, or download it as PDF, Word or PowerPoint. Every format uses the same charts and sentences.' },
  { id: 'help:present', title: 'Slideshow', page: '/present', text: 'Present opens a slideshow of the dashboard, one chart per slide with its narration. Use the arrow keys to move between slides.' },
  { id: 'help:library', title: 'Library and saving', page: '/library', text: 'Save the dashboard with Save; saved dashboards appear in the Library, where you can reopen or share them. A saved dashboard opens read-only if its dataset is not loaded.' },
  { id: 'help:settings', title: 'Settings and AI key', page: '/settings', text: 'Settings holds appearance (light or dark theme) and your account. An AI key (Gemini, Anthropic, OpenAI or xAI) can be added on Home. Without a key everything works; with one, a model helps read columns, writes captions, and answers questions the built-in reader cannot. The model never sees your rows, only column names, types and computed numbers.' },
  { id: 'help:assistant', title: 'The assistant', page: null, text: 'The assistant answers questions about the app and your data, and can change the dashboard (add, edit, remove or move charts, set filters, add KPIs, add measures, fix how a column was read) shape the data (transform steps), load a sample dataset, and open any page. It always shows what it plans to change, and nothing happens until you click Apply. Every applied change can be undone.' },
];

const STOP = new Set('a an the of to in on for by and or is are was were be it its this that with as at from what which where when how do does did i my me we you your can could should would show give tell please about into there their than then'.split(' '));

export function tokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[_\-/]/g, ' ')
    .split(/[^a-z0-9%]+/)
    .filter((t) => t && !STOP.has(t))
    .map((t) => (t.length > 4 ? t.replace(/(ies)$/, 'y').replace(/(es|s)$/, '') : t));
}

/** BM25 over the passages; returns them best first with a score. */
export function search(passages, query, k = 6) {
  const q = [...new Set(tokens(query))];
  if (!q.length || !passages.length) return [];
  const docs = passages.map((p) => tokens(`${p.title} ${p.title} ${p.text}`));
  const avg = docs.reduce((s, d) => s + d.length, 0) / docs.length || 1;
  const df = new Map();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);
  const N = docs.length;
  const scored = passages.map((p, i) => {
    const d = docs[i];
    const tf = new Map();
    for (const t of d) tf.set(t, (tf.get(t) || 0) + 1);
    let score = 0;
    for (const t of q) {
      const f = tf.get(t);
      if (!f) continue;
      const idf = Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5));
      score += (idf * f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (d.length / avg)));
    }
    return { ...p, score };
  });
  return scored.filter((p) => p.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
}

const ROLE_WORD = { time: 'date', dimension: 'category', measure: 'number', id: 'identifier', text: 'text', ignore: 'ignored' };

/** Passages about the reader's own table and dashboard, from live state. */
export function contextPassages({ dataset, engine, board, filters, pathname } = {}) {
  const out = [];
  if (dataset) {
    out.push({
      id: 'data:table',
      title: 'Your dataset, its columns and rows',
      text: `The loaded table is ${dataset.fileName || 'a dataset'} with ${dataset.rowCount ?? '?'} rows and ${(dataset.columns || []).length} columns: ${(dataset.columns || []).join(', ')}.`,
    });
    const steps = dataset.transformSteps || [];
    if (steps.length) out.push({ id: 'data:steps', title: 'Data prep steps applied', text: steps.map((s, i) => `${i + 1}. ${s.describe || s.kind}`).join(' ') });
  }
  for (const f of engine?.ds?.fields || []) {
    const bits = [`Column ${f.name} (${f.label || f.name}) is read as ${ROLE_WORD[f.role] || f.role}`];
    if (f.agg) bits.push(`aggregated by ${f.agg}`);
    if (f.format && f.format !== 'number') bits.push(`formatted as ${f.format}`);
    if (f.distinct != null) bits.push(`${f.distinct} distinct values`);
    if (f.top?.length) bits.push(`top values ${f.top.slice(0, 6).map((t) => (Array.isArray(t) ? t[0] : t?.value ?? t)).join(', ')}`);
    if (f.min != null && f.max != null) bits.push(`range ${f.min} to ${f.max}`);
    out.push({ id: `field:${f.name}`, title: `Column ${f.label || f.name}`, text: bits.join(', ') + '.' });
  }
  const ms = engine?.measures || board?.measures || [];
  if (ms.length) out.push({ id: 'data:measures', title: 'Measures available', text: ms.slice(0, 60).map((m) => `${m.label} [${m.id}]`).join('; ') });
  if (board) {
    for (const k of board.kpis || []) out.push({ id: `kpi:${k.id}`, title: `KPI ${k.title}`, text: `KPI card ${k.title} [${k.id}] shows ${k.formatted}${k.delta ? `, ${k.delta.text} ${k.delta.period || ''} ${k.delta.vs || ''}` : ''}.` });
    for (const s of board.sections || [])
      for (const t of s.tiles || [])
        out.push({ id: `tile:${t.id}`, title: `Chart ${t.title}`, text: `Chart "${t.title}" [${t.id}] in section ${s.title || s.id}, a ${t.viz} of ${(t.measures || []).join(', ') || t.field || ''}${t.dim ? ` by ${t.dim}` : ''}. ${t.insight || ''}` });
    for (const f of board.findings || []) out.push({ id: `finding:${f.id || f.text.slice(0, 20)}`, title: 'Key finding', text: f.text });
    if (board.headline) out.push({ id: 'board:headline', title: 'Dashboard headline', text: board.headline });
  }
  if (filters?.length) out.push({ id: 'state:filters', title: 'Active filters', text: `Filters now applied: ${filters.map((f) => `${f.field} ${f.values ? `= ${f.values.join(', ')}` : `${f.from || ''}–${f.to || ''}`}`).join('; ')}.` });
  if (pathname) out.push({ id: 'state:page', title: 'Current page', text: `The reader is on the ${pathname} page.` });
  return out;
}

/** The passages for one question: the best matches, plus always-useful state. */
export function retrieve(question, state, k = 8) {
  const live = contextPassages(state).map((p) => ({ ...p, live: true }));
  // The reader's own data outranks the manual when both match: "my columns"
  // is about their table, not the page that lists columns in general.
  const hits = search([...HELP, ...live], question, k * 2)
    .map((h) => ({ ...h, score: h.live ? h.score * 1.4 : h.score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
  const always = live.filter((p) => p.id === 'data:table' || p.id === 'state:page' || p.id === 'state:filters');
  const seen = new Set(hits.map((h) => h.id));
  return [...hits, ...always.filter((p) => !seen.has(p.id))];
}
