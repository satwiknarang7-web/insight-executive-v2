'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  FileImage,
  Loader2,
  Plus,
  UploadCloud,
  X,
} from 'lucide-react';
import { useActions } from '../../lib/store/DatasetProvider';
import { EXTRACTABLE_TYPES, isExtractable } from '../../lib/documentExtraction';

/**
 * Reading a table out of a photograph, and then checking it.
 *
 * This used to be one file kind among nine in a catalogue, and loading one was
 * a single movement: a document went in, a dataset came out, and the reader's
 * first sight of what had been read was a finished chart built on it. A model
 * reading a photographed table is right most of the time. "Most of the time"
 * is not a basis for a total.
 *
 * So it is its own screen with three steps, and the middle one is the point:
 *
 *   1. Several documents at once — a report is rarely one page.
 *   2. Every cell editable, with the ones the model flagged as unsure marked
 *      so a reader knows where to look first. Correcting a cell also clears
 *      its doubt, because a cell somebody has typed over is a cell they have
 *      vouched for.
 *   3. Load, once it says what the page says.
 *
 * Columns can be renamed and rows removed here too, because an extraction that
 * invents a header or repeats the title row as data is the common failure and
 * neither is worth going back to the photograph for.
 */

const ACCEPT = [...EXTRACTABLE_TYPES].join(',') + ',.pdf,.png,.jpg,.jpeg,.webp';

export default function DocumentImport({ onLoaded }) {
  const { extractDocuments, ingestExtracted } = useActions();
  const inputRef = useRef(null);

  const [tables, setTables] = useState(null);
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(null);
  const [failed, setFailed] = useState([]);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);

  const read = useCallback(
    async (files) => {
      const list = Array.from(files || []).filter(isExtractable);
      if (!list.length) {
        setError('Those are not documents this can read. Try a PDF, a PNG or a photograph.');
        return;
      }
      setError(null);
      setFailed([]);
      setBusy({ at: 0, of: list.length, fileName: list[0].name });
      try {
        const result = await extractDocuments(list, setBusy);
        setTables(result.tables);
        setFailed(result.failed);
        setAt(0);
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(null);
      }
    },
    [extractDocuments]
  );

  /** One cell, corrected. The doubt on it goes with the correction. */
  const editCell = useCallback((tableIndex, rowIndex, column, value) => {
    setTables((prev) =>
      prev.map((t, i) => {
        if (i !== tableIndex) return t;
        const rows = t.rows.map((r, j) => (j === rowIndex ? { ...r, [column]: value } : r));
        const uncertain = new Set(t.uncertain);
        uncertain.delete(`${rowIndex}:${column}`);
        return { ...t, rows, uncertain };
      })
    );
  }, []);

  const renameColumn = useCallback((tableIndex, column, name) => {
    const next = String(name).trim();
    if (!next || next === column) return;
    setTables((prev) =>
      prev.map((t, i) => {
        if (i !== tableIndex) return t;
        if (t.columns.includes(next)) return t;
        return {
          ...t,
          columns: t.columns.map((c) => (c === column ? next : c)),
          rows: t.rows.map((r) => {
            const { [column]: value, ...rest } = r;
            return { ...rest, [next]: value };
          }),
          uncertain: new Set(
            [...t.uncertain].map((key) => {
              const sep = key.indexOf(':');
              return key.slice(sep + 1) === column ? `${key.slice(0, sep)}:${next}` : key;
            })
          ),
        };
      })
    );
  }, []);

  /**
   * Removing a row renumbers every row after it, and the doubts are keyed by
   * row number — so they are rebuilt rather than left pointing one row down.
   */
  const removeRow = useCallback((tableIndex, rowIndex) => {
    setTables((prev) =>
      prev.map((t, i) => {
        if (i !== tableIndex) return t;
        const uncertain = new Set();
        for (const key of t.uncertain) {
          const sep = key.indexOf(':');
          const row = Number(key.slice(0, sep));
          if (row === rowIndex) continue;
          uncertain.add(`${row > rowIndex ? row - 1 : row}:${key.slice(sep + 1)}`);
        }
        return { ...t, rows: t.rows.filter((_, j) => j !== rowIndex), uncertain };
      })
    );
  }, []);

  const addRow = useCallback((tableIndex) => {
    setTables((prev) =>
      prev.map((t, i) =>
        i === tableIndex ? { ...t, rows: [...t.rows, Object.fromEntries(t.columns.map((c) => [c, '']))] } : t
      )
    );
  }, []);

  const load = useCallback(async () => {
    setBusy({ loading: true });
    setError(null);
    try {
      await ingestExtracted(tables);
      onLoaded?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }, [tables, ingestExtracted, onLoaded]);

  const table = tables?.[at];
  const unsure = table ? table.uncertain.size : 0;
  const totalUnsure = useMemo(
    () => (tables || []).reduce((n, t) => n + t.uncertain.size, 0),
    [tables]
  );

  /* -- before anything is read ------------------------------------------- */
  if (!tables) {
    return (
      <div className="flex flex-col gap-3">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            read(e.dataTransfer.files);
          }}
          onClick={() => !busy && inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-9 text-center transition-colors ${
            dragging
              ? 'border-accent-500 bg-accent-500/8'
              : 'border-white/12 bg-white/[0.02] hover:border-accent-500/40 hover:bg-white/[0.035]'
          }`}
        >
          {busy ? (
            <>
              <Loader2 size={24} className="animate-spin text-accent-400" />
              <div className="text-[13px] font-semibold text-white/80">
                Reading {busy.fileName}
                {busy.of > 1 ? ` — ${busy.at + 1} of ${busy.of}` : ''}
              </div>
              <div className="text-[11px] text-white/35">One vision call per page, on your own key.</div>
            </>
          ) : (
            <>
              <FileImage size={24} className="text-white/30" />
              <div className="text-[13px] font-semibold text-white/80">Drop photographs or PDFs — several at once</div>
              <div className="text-[11px] text-white/35">
                Each page becomes a table. You check what was read before anything is loaded.
              </div>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              read(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
        {error && <Problem>{error}</Problem>}
      </div>
    );
  }

  /* -- the review -------------------------------------------------------- */
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {tables.map((t, i) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setAt(i)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors ${
              i === at
                ? 'border-accent-500/40 bg-accent-500/10 text-accent-300'
                : 'border-white/10 text-white/50 hover:bg-white/5 hover:text-white'
            }`}
          >
            {t.label}
            <span className="text-white/30">{t.rows.length}</span>
            {t.uncertain.size > 0 && (
              <span className="rounded-full bg-amber-500/15 px-1.5 text-[10px] font-bold text-amber-300">
                {t.uncertain.size}
              </span>
            )}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setTables(null);
            setFailed([]);
          }}
          className="ml-auto text-[11px] text-white/35 transition-colors hover:text-white/70"
        >
          Start again
        </button>
      </div>

      <p className="text-[12px] leading-relaxed text-white/45">
        {unsure > 0 ? (
          <>
            <span className="font-semibold text-amber-300">{unsure} cell{unsure === 1 ? '' : 's'}</span> the
            reader was unsure of, marked below. Every cell is editable — correcting one clears its doubt.
          </>
        ) : (
          <>Every cell is editable. Nothing here is loaded until you say so.</>
        )}
      </p>

      {failed.length > 0 && (
        <Problem>
          {failed.map((f) => `${f.fileName}: ${f.reason}`).join(' · ')}
        </Problem>
      )}

      <div className="overflow-x-auto rounded-xl border border-white/8">
        <table className="w-full border-collapse text-left text-[12px]">
          <thead>
            <tr>
              <th className="w-8 border-b border-white/8 bg-white/[0.03] px-2 py-2" />
              {table.columns.map((col) => (
                <th key={col} className="border-b border-white/8 bg-white/[0.03] px-1 py-1.5">
                  <input
                    defaultValue={col}
                    onBlur={(e) => renameColumn(at, col, e.target.value)}
                    aria-label={`Name of the ${col} column`}
                    className="w-full min-w-[7rem] rounded border border-transparent bg-transparent px-1.5 py-1 text-[11px] font-bold text-white/70 outline-none hover:border-white/10 focus:border-accent-500/50"
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r} className="border-b border-white/5">
                <td className="px-1 py-1 align-middle">
                  <button
                    type="button"
                    onClick={() => removeRow(at, r)}
                    aria-label={`Remove row ${r + 1}`}
                    title="Remove this row"
                    className="rounded p-1 text-white/15 transition-colors hover:bg-rose-500/12 hover:text-rose-300"
                  >
                    <X size={12} />
                  </button>
                </td>
                {table.columns.map((col) => {
                  const doubted = table.uncertain.has(`${r}:${col}`);
                  return (
                    <td key={col} className="px-1 py-1">
                      <input
                        value={row[col] ?? ''}
                        onChange={(e) => editCell(at, r, col, e.target.value)}
                        aria-label={`${col}, row ${r + 1}${doubted ? ' — the reader was unsure of this' : ''}`}
                        title={doubted ? 'The reader was unsure of this one' : undefined}
                        className={`w-full min-w-[7rem] rounded border px-1.5 py-1 font-mono text-[11px] outline-none transition-colors focus:border-accent-500/50 ${
                          doubted
                            ? 'border-amber-500/40 bg-amber-500/[0.07] text-amber-100'
                            : 'border-transparent bg-transparent text-white/75 hover:border-white/10'
                        }`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => addRow(at)}
          className="flex items-center gap-1.5 rounded-lg border border-dashed border-white/12 px-3 py-1.5 text-[11px] font-medium text-white/45 transition-colors hover:border-accent-500/30 hover:text-accent-300"
        >
          <Plus size={12} /> Add a row
        </button>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-[11px] font-medium text-white/45 transition-colors hover:bg-white/5 hover:text-white"
        >
          <UploadCloud size={12} /> Add more pages
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            read(e.target.files);
            e.target.value = '';
          }}
        />

        <button
          type="button"
          onClick={load}
          disabled={!!busy}
          className="ml-auto flex items-center gap-2 rounded-xl bg-accent-500 px-5 py-2.5 text-[13px] font-semibold text-on-accent transition-colors hover:bg-accent-400 disabled:opacity-40"
        >
          {busy?.loading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Load {tables.length > 1 ? `${tables.length} tables` : 'this table'}
        </button>
      </div>

      {totalUnsure > 0 && (
        <p className="text-[11px] leading-relaxed text-white/30">
          You can load it with the {totalUnsure} doubtful cell{totalUnsure === 1 ? '' : 's'} left as they are.
          They stay marked, and every finding that rests on them is capped accordingly.
        </p>
      )}

      {error && <Problem>{error}</Problem>}
    </div>
  );
}

function Problem({ children }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-rose-500/25 bg-rose-500/8 px-3 py-2 text-[12px] leading-relaxed text-rose-200">
      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
