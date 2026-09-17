'use client';

import { useMemo, useState } from 'react';
import {
  Braces,
  Cloud,
  Code2,
  Database,
  FileSpreadsheet,
  FileText,
  Globe,
  Image as ImageIcon,
  Layers,
  Link2,
  ClipboardPaste,
  Search,
  Table2,
  Warehouse,
} from 'lucide-react';
import { searchSources, sourceGroups } from '../../lib/sources';

/**
 * "Get data": every source, in a grid, with a search box.
 *
 * A dropdown held nine names and hid the ones a visitor had not thought of.
 * A grid shows what is possible — that a Parquet file or a Google Sheet or
 * an OData feed is one click away — and a search box finds the one they
 * came for without reading the grid at all.
 */

const ICONS = {
  file: FileText,
  excel: FileSpreadsheet,
  json: Braces,
  xml: Code2,
  html: Globe,
  parquet: Layers,
  sqlite: Database,
  document: ImageIcon,
  paste: ClipboardPaste,
  url: Link2,
  googlesheets: Table2,
  restapi: Braces,
  odata: Cloud,
  webpage: Globe,
};
const GROUP_ICONS = { files: FileText, web: Globe, databases: Database, warehouses: Warehouse, services: Cloud };

function iconFor(item) {
  if (ICONS[item.id]) return ICONS[item.id];
  if (item.kind === 'connector') return GROUP_ICONS[item.groupId] || Database;
  return FileText;
}

export default function SourceCatalog({ value, onChange, allowsModel = true }) {
  const [query, setQuery] = useState('');
  const groups = useMemo(() => sourceGroups(), []);
  const results = useMemo(() => (query.trim() ? searchSources(query) : null), [query]);

  const tile = (item, groupId) => {
    const Icon = iconFor({ ...item, groupId });
    const active = value === item.id;
    const locked = item.needs === 'model' && !allowsModel;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => onChange(item.id)}
        title={item.blurb}
        aria-pressed={active}
        className={`group flex min-h-[68px] items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
          active
            ? 'border-accent-500/50 bg-accent-500/10'
            : 'border-white/7 bg-white/[0.02] hover:border-accent-500/30 hover:bg-white/[0.05]'
        }`}
      >
        <Icon size={15} className={`mt-0.5 shrink-0 ${active ? 'text-accent-300' : 'text-white/30 group-hover:text-accent-400'}`} />
        <span className="min-w-0">
          <span className={`block truncate text-[12px] font-bold ${active ? 'text-accent-200' : 'text-white/80'}`}>
            {item.label}
            {locked && (
              <span className="ml-1.5 rounded-full border border-accent-500/30 bg-accent-500/10 px-1.5 py-px text-[8px] font-black uppercase tracking-[0.15em] text-accent-400">
                Pro
              </span>
            )}
          </span>
          <span className="mt-0.5 line-clamp-2 block text-[10px] leading-snug text-white/35">{item.blurb}</span>
        </span>
      </button>
    );
  };

  return (
    <div>
      <div className="relative mb-3">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sources — Postgres, Parquet, Google Sheets, OData…"
          aria-label="Search data sources"
          className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-xs font-medium outline-none placeholder:text-white/25 focus:border-accent-500/50"
        />
      </div>

      {results ? (
        results.length ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{results.map((item) => tile(item, null))}</div>
        ) : (
          <p className="rounded-lg border border-white/6 px-3 py-4 text-center text-[12px] text-white/35">
            Nothing called “{query}”. A file of almost any kind can be dropped in; a database not listed here
            can usually be reached through the Postgres or MySQL connector it is compatible with.
          </p>
        )
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <section key={g.id}>
              <div className="mb-1.5 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/30">
                {g.label}
                <span className="font-normal text-white/20">{g.items.length}</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{g.items.map((item) => tile(item, g.id))}</div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
