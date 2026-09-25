/**
 * Print the dashboard the engine builds for every table in eval/data and
 * tests/corpus: its headline numbers, each chart with its caption, and the key
 * findings. `node eval/dashboards.mjs [pattern]` — the pattern narrows the files.
 * Read it the way a reviewer would read the dashboard: would an analyst have
 * built this, and is every sentence true and worth saying?
 */
import fs from 'node:fs';
import path from 'node:path';
import { ingest } from './chain.mjs';
import { buildDashboard } from '../lib/engine/planner.js';

const ROOT = path.join(import.meta.dirname, '..');
const dirs = [path.join(ROOT, 'eval/data'), path.join(ROOT, 'tests/corpus')].filter((d) => fs.existsSync(d));
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
for (const dir of dirs) {
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.csv')).sort()) {
    if (only && !only.test(f)) continue;
    const rows = ingest(fs.readFileSync(path.join(dir, f), 'utf8')).rows;
    const t0 = Date.now();
    const d = buildDashboard(rows, { name: f });
    console.log(`\n### ${f} [${rows.length} rows, read as ${d.ds.shape}] ${d.summary} (${Date.now() - t0} ms)`);
    console.log('KPIs: ' + d.kpis.map((k) => `${k.title} = ${k.formatted}${k.delta ? ` (${k.delta.text} ${k.delta.vs})` : ''}`).join(' | '));
    for (const s of d.sections) for (const t of s.tiles) console.log(`  [${s.title || 'main'}] ${t.viz}: ${t.title}\n      ${t.insight}`);
    if (d.findings.length) console.log('Key findings:\n' + d.findings.map((x) => `  • ${x.text}`).join('\n'));
  }
}
