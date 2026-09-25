/**
 * The assistant with no model: a reader of the commands people actually type,
 * and a librarian for everything else. Commands become the same raw actions a
 * model would propose (checked the same way by actions.js); anything that is
 * not a command is answered from the retrieved passages, or — when it reads
 * as a question about the data — by the engine's own question reader.
 */
import { PAGES, findField } from './actions.js';
import { tokens } from './retrieve.js';

const PAGE_WORDS = [
  [/\b(slide ?show|slides|present(ation)?|deck)\b/, 'present'],
  [/\b(report|export|pdf|word|powerpoint|pptx|docx|print)\b/, 'report'],
  [/\b(summary|executive summary|overview page)\b/, 'summary'],
  [/\b(explore|rows|raw data|data table|data prep|transform(s|ations)?)\b/, 'explore'],
  [/\b(quality|cleaning|cleaner)\b/, 'quality'],
  [/\b(data model|model page|joins?|relationships page)\b/, 'model'],
  [/\b(library|saved( dashboards)?)\b/, 'library'],
  [/\b(settings|theme|appearance|account)\b/, 'settings'],
  [/\b(ask|question page)\b/, 'ask'],
  [/\b(dashboard|charts)\b/, 'dashboard'],
  [/\b(home|upload|start)\b/, 'home'],
];

const VIZ_WORDS = [
  [/\bstacked\b/, 'stackedColumn'],
  [/\b(line)\b/, 'line'],
  [/\barea\b/, 'area'],
  [/\b(column|vertical bar)s?\b/, 'column'],
  [/\b(bar|horizontal bar)s?\b/, 'hbar'],
  [/\b(donut|doughnut|pie)\b/, 'donut'],
  [/\btable\b/, 'table'],
  [/\bscatter\b/, 'scatter'],
  [/\bhistogram\b/, 'histogram'],
  [/\bheat ?map\b/, 'heatmap'],
];

const ROLE_WORDS = [
  [/\b(date|time|period)\b/, 'time'],
  [/\b(category|categorical|dimension|group|label)\b/, 'dimension'],
  [/\b(number|measure|numeric|amount|value)\b/, 'measure'],
  [/\b(id|identifier|key)\b/, 'id'],
  [/\b(text|free text|note)\b/, 'text'],
  [/\b(ignore|ignored|hidden)\b/, 'ignore'],
];

const TRANSFORM = /^(rename|drop|keep|add (a )?(column|row number)|split|combine|merge|trim|uppercase|lowercase|proper case|replace|fill|remove (duplicates|blank|rows|the .* column)|dedupe|sort|band|bucket|extract|group by|read .* as|unpivot|pivot|filter rows|delete rows|delete the .* column)\b/;

/** The chart on the dashboard a phrase most likely names. */
export function matchTile(board, phrase) {
  const want = new Set(tokens(phrase));
  if (!want.size) return null;
  let best = null;
  for (const t of (board?.sections || []).flatMap((s) => s.tiles || [])) {
    const have = tokens(t.title);
    const hit = have.filter((w) => want.has(w)).length;
    const score = hit / Math.max(have.length, 1) + hit * 0.01;
    if (hit && (!best || score > best.score)) best = { tile: t, score };
  }
  return best && best.score >= 0.5 ? best.tile : null;
}

/** A value of some category column that a phrase names, e.g. "West". */
function matchValue(fields, phrase) {
  const p = ` ${String(phrase).toLowerCase()} `;
  for (const f of fields) {
    if (f.role !== 'dimension' && f.role !== 'id') continue;
    for (const t of f.top || []) {
      const v = String(Array.isArray(t) ? t[0] : t);
      if (v.length >= 2 && p.includes(` ${v.toLowerCase()} `)) return { field: f.name, value: v };
    }
  }
  return null;
}

/** Read one message. Returns { actions, reply, engineQuestion }. */
export function readCommand(text, { board, engine } = {}) {
  const raw = String(text || '').trim();
  const t = raw.toLowerCase().replace(/[?.!]+$/, '').trim();
  const fields = engine?.ds?.fields || [];
  const measures = engine?.measures || [];
  if (!t) return { actions: [] };

  const ROLE = { time: 'date', dimension: 'category', measure: 'number', id: 'identifier', text: 'text', ignore: 'ignored' };
  if (/\b(what|which|list|show)\b.*\b(columns|fields)\b/.test(t) && fields.length) {
    return { actions: [], reply: `Your data has ${fields.length} columns:\n${fields.map((f) => `• ${f.label || f.name} — ${ROLE[f.role] || f.role}${f.format && f.format !== 'number' ? `, ${f.format}` : ''}`).join('\n')}` };
  }
  if (/\bhow many (rows|records|lines|entries)\b/.test(t) && engine?.ds?.rowCount != null) {
    return { actions: [], reply: `There are ${engine.ds.rowCount.toLocaleString('en-US')} rows.` };
  }
  if (/^(undo|revert)\b/.test(t)) return { actions: [], undo: true };
  if (/\b(rebuild|regenerate|start over|redo) (the )?dashboard\b/.test(t)) return { actions: [{ type: 'rebuild' }] };
  if (/\b(clear|remove|reset) (all )?(the )?filters?\b/.test(t) && !/\bon\b/.test(t)) return { actions: [{ type: 'clear_filters' }] };

  let m;
  if ((m = t.match(/^(go to|open|take me to|show me|switch to|navigate to)\s+(the\s+)?(.+?)(\s+page)?$/))) {
    const hit = PAGE_WORDS.find(([re]) => re.test(m[3]));
    if (hit && (m[4] || m[3].split(' ').length <= 3)) return { actions: [{ type: 'navigate', page: hit[1] }] };
  }

  if (TRANSFORM.test(t)) return { actions: [{ type: 'transform', phrase: raw }] };

  if ((m = t.match(/^(remove|delete|hide|drop) (the )?(.+?) (chart|graph|kpi|card)$/)) || (m = t.match(/^(remove|delete|hide) (the )?(chart|graph) (.+)$/))) {
    const name = m[4] && !['chart', 'graph', 'kpi', 'card'].includes(m[4]) ? m[4] : m[3];
    if (/kpi|card/.test(m[4] || '')) {
      const k = (board?.kpis || []).find((x) => tokens(x.title).every((w) => tokens(name).includes(w)) || x.title.toLowerCase() === name);
      return k ? { actions: [{ type: 'remove_kpi', id: k.id }] } : { actions: [], reply: `I couldn't find a KPI called "${name}".` };
    }
    const tile = matchTile(board, name);
    return tile ? { actions: [{ type: 'remove_chart', id: tile.id }] } : { actions: [], reply: `I couldn't find a chart matching "${name}". Chart titles are listed on the dashboard.` };
  }

  if ((m = t.match(/^move (the )?(.+?)( chart)? (up|down|to the top|higher|lower)$/))) {
    const tile = matchTile(board, m[2]);
    if (tile) return { actions: [{ type: 'move_chart', id: tile.id, dir: /up|top|higher/.test(m[4]) ? -1 : 1 }] };
  }

  if ((m = t.match(/^(make|show|change|turn|switch|display) (the )?(.+?)( chart)? (as|into|to) (a |an )?(.+?)( chart)?$/))) {
    const viz = VIZ_WORDS.find(([re]) => re.test(m[7]));
    const tile = matchTile(board, m[3]);
    if (viz && tile) return { actions: [{ type: 'edit_chart', id: tile.id, patch: { viz: viz[1] } }] };
    const grain = m[7].match(/\b(daily|weekly|monthly|quarterly|yearly|annual|day|week|month|quarter|year)\b/);
    if (grain && tile) {
      const g = { daily: 'day', weekly: 'week', monthly: 'month', quarterly: 'quarter', yearly: 'year', annual: 'year' }[grain[1]] || grain[1];
      return { actions: [{ type: 'edit_chart', id: tile.id, patch: { grain: g } }] };
    }
  }

  if ((m = t.match(/^(show|keep)? ?top (\d+) (in|on|for) (the )?(.+?)( chart)?$/))) {
    const tile = matchTile(board, m[5]);
    if (tile) return { actions: [{ type: 'edit_chart', id: tile.id, patch: { limit: Number(m[2]) } }] };
  }

  if ((m = t.match(/^(treat|read|mark|set|make) (the )?(.+?)( column)? as (a |an )?(.+)$/))) {
    const f = findField(fields, m[3]);
    const role = ROLE_WORDS.find(([re]) => re.test(m[6]));
    const fmt = /\b(money|currency|dollars?)\b/.test(m[6]) ? 'currency' : /\bpercent(age)?\b/.test(m[6]) ? 'percent' : null;
    const agg = /\b(average|avg|mean)\b/.test(m[6]) ? 'avg' : /\b(sum|total|adds? up)\b/.test(m[6]) ? 'sum' : /\bmedian\b/.test(m[6]) ? 'median' : null;
    if (f && (role || fmt || agg)) return { actions: [{ type: 'set_field', field: f.name, ...(fmt || agg ? {} : { role: role[1] }), ...(fmt ? { format: fmt } : {}), ...(agg ? { role: 'measure', agg } : {}) }] };
  }
  if ((m = t.match(/^ignore (the )?(.+?)( column)?$/))) {
    const f = findField(fields, m[2]);
    if (f) return { actions: [{ type: 'set_field', field: f.name, role: 'ignore' }] };
  }

  if ((m = t.match(/^add (a )?(kpi|card|kpi card|headline number) (for |of |showing )?(.+)$/))) {
    const want = m[4];
    const hit = measures.find((x) => x.label.toLowerCase() === want) || measures.find((x) => tokens(x.label).join(' ') === tokens(want).join(' ')) || measures.find((x) => tokens(want).every((w) => tokens(x.label).includes(w)));
    return hit ? { actions: [{ type: 'add_kpi', measure: hit.id }] } : { actions: [], reply: `There's no measure called "${want}". Measures: ${measures.slice(0, 12).map((x) => x.label).join(', ')}.` };
  }

  if ((m = t.match(/^(filter|only show|show only|limit to|focus on|just)( the)?( dashboard)?( to| on| by)? (.+)$/))) {
    const rest = m[5];
    const fv = rest.match(/^(.+?) (is|=|to|equals) (.+)$/);
    if (fv) {
      const f = findField(fields, fv[1]);
      if (f) return { actions: [{ type: 'set_filter', field: f.name, values: fv[3].split(/,| and | or /).map((s) => s.trim()).filter(Boolean) }] };
    }
    const hit = matchValue(fields, rest);
    if (hit) return { actions: [{ type: 'set_filter', field: hit.field, values: [hit.value] }] };
    const year = rest.match(/\b(19|20)\d\d\b/);
    const time = fields.find((f) => f.role === 'time');
    if (year && time) return { actions: [{ type: 'set_filter', field: time.name, from: `${year[0]}-01-01`, to: `${year[0]}-12-31` }] };
  }

  if ((m = t.match(/^(add|create|make|build|plot|chart|graph|draw)( me)?( a| an)?( new)?( chart| graph| plot)?( of| for| showing)? (.+)$/))) {
    return { actions: [{ type: 'add_chart', question: m[7] }] };
  }

  return { actions: [], engineQuestion: /\b(by|over time|trend|top \d+|vs|versus|distribution|total|average|how many|how much|which|highest|lowest|most|least)\b/.test(t) };
}

/** An answer from passages alone: the best ones, as they are. */
export function answerFromPassages(question, passages) {
  const scored = passages.filter((p) => p.score > 0);
  // The reader's own table first when it is among the best matches.
  const top = [...scored.slice(0, 3).filter((p) => p.live), ...scored.filter((p) => !p.live)].slice(0, 2);
  if (!top.length) return "I couldn't find anything on that. Try asking about a page (dashboard, report, explore), a column in your data, or say what to change, e.g. \"add revenue by region\".";
  return top.map((p) => p.text).join('\n\n');
}

export { PAGES };
