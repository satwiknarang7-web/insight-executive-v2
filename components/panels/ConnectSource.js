'use client';

/**
 * Connect to one data source, from the upload page.
 *
 * The source dropdown that owns this component treats a spreadsheet and a
 * database as the same kind of choice, so this has to feel like the same kind
 * of step: pick the source, give it what it needs, choose your tables. There is
 * no separate "connections" destination to visit first.
 *
 * Only the fields the driver genuinely requires are shown. Everything the
 * registry marks `advanced` — a schema, a role, a non-default port — is folded
 * away behind a disclosure, because a form that opens with ten boxes reads as
 * ten decisions when eight of them have correct defaults.
 *
 * A credential goes straight to the vault and is never read back; the reply
 * carries an id, and from then on this component refers to the connection by
 * that id alone.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ClipboardPaste, Loader2, Lock, Plus, ShieldCheck } from 'lucide-react';
import {
  connectionIsFor,
  getConnector,
  defaultConfig,
  validateConfig,
} from '../../lib/connectors/registry';
import { CONNECTION_STRING_EXAMPLES, parseConnectionString } from '../../lib/connectors/connectionString';
import ImportFromConnection from './ImportFromConnection';
import FabricTarget from './FabricTarget';
import { hasTarget } from '../../lib/connectors/fabricApi';

export default function ConnectSource({ source, organization, onNeedsAccount }) {
  const connector = getConnector(source);

  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('list'); // list | new
  const [importing, setImporting] = useState(null);
  const [config, setConfig] = useState(() => defaultConfig(source));
  const [name, setName] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState([]);
  // Pasting a connection string is an alternative way to *fill in* the form,
  // never a way past it: what it produces lands in the same fields, and the
  // user sees every one of them before anything reaches the vault.
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [pasteNote, setPasteNote] = useState(null);
  // A connection whose credentials are saved but which has not been pointed at
  // anything yet. Fabric is the only source with this state.
  const [needsTarget, setNeedsTarget] = useState(null);

  // A new source is a fresh form; carrying the previous one's values across
  // would silently send a Postgres port to MySQL.
  useEffect(() => {
    setConfig(defaultConfig(source));
    setName('');
    setProblems([]);
    setShowAdvanced(false);
    setMode('list');
    setPasting(false);
    setPasted('');
    setPasteNote(null);
  }, [source]);

  /**
   * Read a pasted string into the form.
   *
   * A string for a different source than the one selected is not an error — the
   * dropdown is a guess about what you are connecting to and the string is the
   * fact. It is reported rather than silently accepted, though, because the
   * fields on screen are about to change out from under the reader.
   */
  const applyConnectionString = useCallback(() => {
    const parsed = parseConnectionString(pasted);
    if (parsed.error) {
      setPasteNote(null);
      setProblems([parsed.error]);
      return;
    }

    setProblems([]);
    setConfig({ ...defaultConfig(parsed.source), ...parsed.config });
    setPasting(false);
    setPasted('');

    if (parsed.source !== source) {
      const label = getConnector(parsed.source)?.label || parsed.source;
      setPasteNote(
        `That is a ${label} connection string. The fields below are filled in — switch the source above to ${label} before connecting.`
      );
    } else {
      setPasteNote('Filled in from the connection string. Check it, then connect.');
    }
  }, [pasted, source]);

  const refresh = useCallback(async () => {
    if (!organization?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/connections?org=${encodeURIComponent(organization.id)}`);
      if (res.status === 401) {
        onNeedsAccount?.();
        return;
      }
      const body = await res.json().catch(() => ({}));
      setConnections(Array.isArray(body.connections) ? body.connections : []);
    } catch {
      setConnections([]);
    } finally {
      setLoading(false);
    }
  }, [organization?.id, onNeedsAccount]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const mine = useMemo(
    // Matched on the flavour rather than the stored source, so a Neon
    // connection lists under Neon and not under PostgreSQL.
    () => connections.filter((c) => connectionIsFor(c, source) && !c.revoked_at),
    [connections, source]
  );

  // Once something is saved, "add another" is the exception rather than the
  // default; with nothing saved the form IS the page.
  useEffect(() => {
    if (!loading && mine.length === 0) setMode('new');
  }, [loading, mine.length]);

  const fields = connector?.fields || [];
  const visible = fields.filter((f) => applies(f, config) && !f.advanced);
  const advanced = fields.filter((f) => applies(f, config) && f.advanced);

  const save = async () => {
    setBusy(true);
    setProblems([]);
    try {
      const issues = validateConfig(source, config);
      if (issues.length) {
        setProblems(issues);
        return;
      }
      const res = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: organization.id,
          name: name.trim() || `${connector.label} connection`,
          source,
          config,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not save that connection.');

      await refresh();

      // A source that discovers its own target is not finished yet: the
      // credentials are stored, but nothing has been chosen for them to point
      // at. Sending the user to "choose tables" here would show an error from a
      // driver that has no hostname to dial.
      if (connector.discovers && !hasTarget(body.connection?.config)) {
        setNeedsTarget(body.connection || null);
        setMode('list');
        return;
      }

      // Straight into choosing tables — saving a connection was never the goal.
      if (body.connection?.id) setImporting(body.connection.id);
      setMode('list');
    } catch (e) {
      setProblems([e.message]);
    } finally {
      setBusy(false);
    }
  };

  if (!connector) return null;

  if (!organization?.id) {
    return (
      <div className="card flex items-start gap-3 p-5">
        <Loader2 size={15} className="mt-0.5 animate-spin text-white/30" />
        <p className="text-[13px] leading-relaxed text-white/50">Getting your workspace ready…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] leading-relaxed text-white/45">{connector.blurb}</p>

      {/* Saved connections for this source */}
      {mine.length > 0 && mode === 'list' && (
        <div className="flex flex-col gap-2">
          {mine.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => (connector.discovers && !hasTarget(c.config) ? setNeedsTarget(c) : setImporting(c.id))}
              className="group flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3 text-left transition-colors hover:border-accent-500/30 hover:bg-white/[0.05]"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-white/85 group-hover:text-accent-300">{c.name}</div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-white/35">
                  {describe(c)}
                </div>
              </div>
              <span className="shrink-0 text-[10px] font-black uppercase tracking-[0.15em] text-white/30 group-hover:text-accent-400">
                {connector.discovers && !hasTarget(c.config) ? 'Finish setup' : 'Choose tables'}
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setMode('new')}
            className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/12 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-white/40 transition-colors hover:border-accent-500/40 hover:text-white"
          >
            <Plus size={13} /> Another {connector.label} connection
          </button>
        </div>
      )}

      {/* The form */}
      {mode === 'new' && (
        <div className="flex flex-col gap-3">
          {CONNECTION_STRING_EXAMPLES[source] && !pasting && (
            <button
              type="button"
              onClick={() => {
                setPasting(true);
                setPasteNote(null);
              }}
              className="flex items-center gap-2 self-start rounded-lg border border-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 transition-colors hover:border-accent-500/40 hover:text-white"
            >
              <ClipboardPaste size={13} /> Paste a connection string
            </button>
          )}

          {pasting && (
            <div className="flex flex-col gap-2 rounded-xl border border-accent-500/25 bg-accent-500/[0.05] p-3">
              <span className="label">Connection string</span>
              <textarea
                rows={3}
                autoFocus
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder={CONNECTION_STRING_EXAMPLES[source]}
                className="resize-y rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-[11px] leading-relaxed text-white/85 outline-none placeholder:text-white/20 focus:border-accent-500/50"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={applyConnectionString}
                  disabled={!pasted.trim()}
                  className="rounded-lg bg-accent-500 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400 disabled:opacity-40"
                >
                  Fill the form
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPasting(false);
                    setPasted('');
                  }}
                  className="rounded-lg border border-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 transition-colors hover:bg-white/5 hover:text-white"
                >
                  Cancel
                </button>
                <span className="ml-auto text-[11px] text-white/30">
                  Nothing is sent until you press Connect.
                </span>
              </div>
            </div>
          )}

          {pasteNote && (
            <p className="rounded-lg border border-accent-500/25 bg-accent-500/8 px-3 py-2 text-[12px] leading-relaxed text-accent-200">
              {pasteNote}
            </p>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="label">Name this connection</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`${connector.label} — read only`}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85 outline-none placeholder:text-white/25 focus:border-accent-500/50"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            {visible.map((field) => (
              <Field key={field.name} field={field} value={config[field.name]} onChange={(v) => setConfig((c) => ({ ...c, [field.name]: v }))} />
            ))}
          </div>

          {advanced.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex items-center gap-1.5 text-[11px] font-bold text-white/40 transition-colors hover:text-white/70"
              >
                <ChevronDown size={12} className={showAdvanced ? 'rotate-180 transition-transform' : 'transition-transform'} />
                {showAdvanced ? 'Hide' : 'Show'} advanced options ({advanced.length})
              </button>
              {showAdvanced && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {advanced.map((field) => (
                    <Field key={field.name} field={field} value={config[field.name]} onChange={(v) => setConfig((c) => ({ ...c, [field.name]: v }))} />
                  ))}
                </div>
              )}
            </div>
          )}

          {problems.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-500/25 bg-rose-500/8 px-3 py-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-rose-400" />
              <ul className="flex flex-col gap-0.5">
                {problems.map((p, i) => (
                  <li key={i} className="text-[12px] text-rose-300">{p}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="flex items-center gap-2 rounded-xl bg-accent-500 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400 disabled:opacity-50"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Lock size={13} />}
              {busy ? 'Saving' : 'Connect'}
            </button>
            {mine.length > 0 && (
              <button
                type="button"
                onClick={() => setMode('list')}
                className="rounded-xl border border-white/10 px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 transition-colors hover:bg-white/5 hover:text-white"
              >
                Cancel
              </button>
            )}
            <span className="ml-auto flex items-center gap-1.5 text-[11px] text-white/30">
              <ShieldCheck size={12} /> Encrypted; never sent back to the browser
            </span>
          </div>
        </div>
      )}

      {needsTarget && (
        <FabricTarget
          organization={organization}
          connection={needsTarget}
          onChosen={async (updated) => {
            setNeedsTarget(null);
            await refresh();
            if (updated?.id) setImporting(updated.id);
          }}
        />
      )}

      {importing && (
        <ImportFromConnection
          organization={organization}
          connections={mine.length ? mine : connections}
          initialConnectionId={importing}
          onClose={() => setImporting(null)}
        />
      )}
    </div>
  );
}

/** A field only applies when its `requiredWhen` condition is met. */
function applies(field, config) {
  if (!field.requiredWhen) return true;
  const [key, value] = Object.entries(field.requiredWhen)[0];
  return config[key] === value;
}

/** A short, non-secret description of where a connection points. */
function describe(connection) {
  const c = connection.config || {};
  return (
    [c.host || c.server || c.account || c.endpoint, c.database || c.site || c.warehouse]
      .filter(Boolean)
      .join(' · ') || connection.source
  );
}

function Field({ field, value, onChange }) {
  const common =
    'rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85 outline-none placeholder:text-white/25 focus:border-accent-500/50';

  return (
    <label className={`flex flex-col gap-1.5 ${field.type === 'textarea' ? 'sm:col-span-2' : ''}`}>
      <span className="label flex items-center gap-1.5">
        {field.label}
        {field.secret && <Lock size={9} className="text-accent-400/70" />}
      </span>

      {field.type === 'boolean' ? (
        <button
          type="button"
          onClick={() => onChange(!value)}
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold transition-colors ${
            value
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-white/10 bg-white/5 text-white/45'
          }`}
        >
          {value ? '✓ Yes' : 'No'}
        </button>
      ) : field.type === 'select' ? (
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={`${common} font-bold`}>
          {(field.options || []).map((o) => (
            <option key={o.value} value={o.value} className="bg-surface">
              {o.label}
            </option>
          ))}
        </select>
      ) : field.type === 'textarea' ? (
        <textarea
          rows={3}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className={`${common} resize-y font-mono text-[11px]`}
        />
      ) : (
        <input
          type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'}
          value={value ?? ''}
          onChange={(e) => onChange(field.type === 'number' ? Number(e.target.value) : e.target.value)}
          placeholder={field.placeholder}
          autoComplete={field.secret ? 'new-password' : 'off'}
          className={common}
        />
      )}

      {field.help && <span className="text-[11px] leading-relaxed text-white/30">{field.help}</span>}
    </label>
  );
}
