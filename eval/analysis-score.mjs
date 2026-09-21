import fs from 'node:fs';
import path from 'node:path';
import { ingest } from './chain.mjs';
import { runAnalysis } from '../lib/pipeline.js';
import { profileColumns } from '../lib/chartResolver.js';

const DIR = path.join(import.meta.dirname, 'data');
const files = fs.readdirSync(DIR).sort();
const only = process.argv[2];

for (const f of files) {
  if (only && !f.includes(only)) continue;
  const t0 = Date.now();
  const { rows, columns } = ingest(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const p = profileColumns(rows);
  const tClean = Date.now() - t0;

  let result;
  let error = null;
  const t1 = Date.now();
  try {
    result = runAnalysis(rows, { maxCharts: 8 });
  } catch (e) {
    error = e;
  }
  const tRun = Date.now() - t1;

  console.log(`\n${'═'.repeat(78)}`);
  console.log(`${f}   ${rows.length} rows × ${columns.length} cols   clean ${tClean}ms · analyse ${tRun}ms`);
  console.log(`  measures  (${p.measures.length}): ${p.measures.slice(0, 10).join(', ')}${p.measures.length > 10 ? ', …' : ''}`);
  console.log(`  dimensions(${p.dimensions.length}): ${p.dimensions.slice(0, 10).join(', ')}${p.dimensions.length > 10 ? ', …' : ''}`);
  console.log(`  temporal: ${JSON.stringify(p.temporal)}`);

  if (error) {
    console.log(`  *** THREW: ${error.message}`);
    continue;
  }

  console.log(`  KPIs: ${(result.kpis || []).map((k) => `${k.label}=${k.value}`).join(' | ') || '(none)'}`);
  const charts = result.charts || [];
  console.log(`  charts (${charts.length}):`);
  for (const c of charts) {
    const tier = (result.perChart || []).find((x) => x.id === c.id)?.metrics?.evidence;
    console.log(`    [${String(c.chart_type).padEnd(9)}] ${c.rowLevel ? 'ROW ' : '    '}${tier ? `${tier.padEnd(10)}` : '          '} ${c.title}`);
  }
  console.log(`  findings:`);
  for (const fi of result.perChart || []) {
    if (!fi.headline) continue;
    console.log(`    · ${fi.headline}`);
    const notes = fi.metrics?.evidenceNotes || [];
    if (notes.length) console.log(`        (${notes.join('; ')})`);
  }
  const anySum = charts.some((c) => /\bSUM\(/i.test(c.sql || ''));
  console.log(`  sums anything? ${anySum ? 'YES → ' + charts.filter((c) => /\bSUM\(/i.test(c.sql || '')).map((c) => c.title).join(' / ') : 'no'}`);
}
