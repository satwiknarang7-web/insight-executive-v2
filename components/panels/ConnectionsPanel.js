'use client';

/**
 * Manage stored database connections.
 *
 * Credentials go one way through this screen. A saved connection comes back as
 * host, port and username — never the password — because the server has no path
 * that returns one. Editing a connection therefore asks for the credential
 * again rather than pre-filling a masked value that could not be real.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ClipboardPaste,
  Database,
  Loader2,
  Lock,
  Plus,
  Download,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import {
  CONNECTORS,
  connectorFor,
  defaultConfig,
  getConnector,
  isAvailable,
  validateConfig,
} from '../../lib/connectors/registry';
import { CONNECTION_STRING_EXAMPLES, parseConnectionString } from '../../lib/connectors/connectionString';
import { hasTarget } from '../../lib/connectors/fabricApi';
import FabricTarget from './FabricTarget';
import ImportFromConnection from './ImportFromConnection';



export default function ConnectionsPanel({ organization }) {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  // Saved credentials that have not been pointed at anything yet. Fabric alone
  // has this state: its target is discovered rather than typed.
  const [targeting, setTargeting] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/connections?org=${encodeURIComponent(organization.id)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not load connections.');
      setConnections(body.connections || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [organization.id]);

  useEffect(() => {
    load();
  }, [load]);

  const revoke = useCallback(
    async (connection) => {
      const res = await fetch(
        `/api/connections/${connection.id}?org=${encodeURIComponent(organization.id)}`,
        { method: 'DELETE' }
      );
      if (res.ok) load();
      else setError((await res.json()).error || 'Could not revoke that connection.');
    },
    [organization.id, load]
  );

  const live = connections.filter((c) => !c.revoked_at);
  const revoked = connections.filter((c) => c.revoked_at);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Connections</h1>
          <p className="mt-1 text-sm text-white/45">
            {organization.name} · credentials are encrypted before they are stored
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {live.length > 0 && (
            <button
              onClick={() => setImporting(true)}
              className="flex items-center gap-2 rounded-lg border border-accent-500/25 bg-accent-500/8 px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-accent-300 transition-colors hover:bg-accent-500/15"
            >
              <Download size={13} /> Import data
            </button>
          )}
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400"
          >
            <Plus size={13} /> Add connection
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-500/25 bg-rose-500/8 px-3 py-2 text-[13px] text-rose-300">
          {error}
        </p>
      )}

      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.05] p-4">
        <div className="mb-1.5 flex items-center gap-2">
          <AlertTriangle size={13} className="text-amber-400" />
          <span className="label !text-amber-400/80">Different from uploading a file</span>
        </div>
        <p className="text-[13px] leading-relaxed text-white/60">
          Spreadsheets are analysed entirely in your browser and never reach a server. A connected database
          is not: the query runs from the server using the credentials stored here, and the rows come back
          through it. Use a read-only database role.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-white/35">
          <Loader2 size={14} className="animate-spin" /> Loading connections
        </div>
      ) : live.length === 0 ? (
        <div className="card flex flex-col items-start gap-3 p-8">
          <Database size={26} className="text-accent-400" />
          <h2 className="text-base font-black">No connections yet</h2>
          <p className="max-w-md text-sm leading-relaxed text-white/45">
            Add a PostgreSQL or Supabase connection and you can pull tables from it straight away. The other
            sources store their credentials now and connect when their driver lands.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {live.map((c) => (
            <ConnectionRow
              key={c.id}
              connection={c}
              onRevoke={() => revoke(c)}
              onFinish={getConnector(c.source)?.discovers && !hasTarget(c.config) ? () => setTargeting(c) : null}
            />
          ))}
        </div>
      )}

      {revoked.length > 0 && (
        <details className="card p-5">
          <summary className="cursor-pointer list-none">
            <span className="label">Revoked ({revoked.length})</span>
          </summary>
          <div className="mt-3 flex flex-col gap-2">
            {revoked.map((c) => (
              <div key={c.id} className="flex items-center gap-3 text-[13px] text-white/35">
                <Lock size={12} />
                <span className="font-bold">{c.name}</span>
                <span className="ml-auto font-mono text-[11px]">
                  {new Date(c.revoked_at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-white/25">
            The credential was destroyed when the connection was revoked. The record is kept so the audit
            trail still has something to point at.
          </p>
        </details>
      )}

      {importing && (
        <ImportFromConnection
          organization={organization}
          connections={live}
          onClose={() => setImporting(false)}
        />
      )}

      {targeting && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-8"
          onClick={() => setTargeting(null)}
          role="presentation"
        >
          <div
            className="panel slide-in my-auto w-full max-w-xl p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Finish setting up this connection"
          >
            <div className="mb-4 flex items-center gap-3">
              <Database size={16} className="text-accent-400" />
              <h2 className="text-base font-black">{targeting.name}</h2>
              <button
                onClick={() => setTargeting(null)}
                aria-label="Close"
                className="ml-auto rounded-lg border border-white/10 p-1.5 text-white/40 hover:bg-white/5 hover:text-white"
              >
                <X size={14} />
              </button>
            </div>
            <FabricTarget
              organization={organization}
              connection={targeting}
              onChosen={() => {
                setTargeting(null);
                load();
              }}
            />
          </div>
        </div>
      )}

      {adding && (
        <AddConnection
          organization={organization}
          onClose={() => setAdding(false)}
          onSaved={(saved) => {
            setAdding(false);
            load();
            // Credentials stored, but nothing chosen for them to point at yet.
            if (saved?.config && !hasTarget(saved.config) && getConnector(saved.source)?.discovers) {
              setTargeting(saved);
            }
          }}
        />
      )}
    </div>
  );
}

function ConnectionRow({ connection, onRevoke, onFinish }) {
  const [confirming, setConfirming] = useState(false);
  // The flavour it was set up as, not just the driver behind it: a Neon
  // connection stores as `postgres` and would otherwise read as PostgreSQL.
  const connector = connectorFor(connection);
  const cfg = connection.config || {};
  const target = [cfg.host || cfg.server || cfg.account || cfg.endpoint, cfg.database]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="card flex flex-wrap items-center gap-3 p-4">
      <Database size={16} className="shrink-0 text-accent-400" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-black text-white/90">{connection.name}</div>
        <div className="truncate font-mono text-[11px] text-white/35">
          {connector?.label || connection.source}
          {target ? ` — ${target}` : ''}
        </div>
      </div>

      {/* Credentials stored, but nothing chosen for them to point at. Saying so
          on the row matters: the connection looks finished otherwise, and the
          first sign that it is not would be a failed import. */}
      {onFinish && (
        <button
          type="button"
          onClick={onFinish}
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.15em] text-amber-300 transition-colors hover:bg-amber-500/20"
        >
          Finish setup
        </button>
      )}

      {connection.last_used_at && !onFinish && (
        <span className="hidden font-mono text-[10px] text-white/25 sm:block">
          used {new Date(connection.last_used_at).toLocaleDateString()}
        </span>
      )}

      {confirming ? (
        <div className="flex items-center gap-2">
          <button
            onClick={onRevoke}
            className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.15em] text-rose-300"
          >
            Revoke for good
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="rounded-lg border border-white/10 p-1.5 text-white/40 hover:text-white"
            aria-label="Cancel"
          >
            <X size={13} />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="rounded-lg p-2 text-white/20 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
          aria-label={`Revoke ${connection.name}`}
          title="Revoke"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

function AddConnection({ organization, onClose, onSaved }) {
  const [sourceId, setSourceId] = useState('postgres');
  const [name, setName] = useState('');
  const [config, setConfig] = useState(() => defaultConfig('postgres'));
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState([]);
  // Pasting a connection string fills the form in; it never bypasses it. The
  // fields — including the password — are on screen before anything is saved,
  // because what goes into the vault should be something you have seen.
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [pasteNote, setPasteNote] = useState(null);

  const connector = getConnector(sourceId);

  const choose = useCallback((id) => {
    setSourceId(id);
    setConfig(defaultConfig(id));
    setProblems([]);
    setPasteNote(null);
  }, []);

  /**
   * Read a pasted string into the form, switching source if it names another.
   *
   * The source buttons above are a guess about what is being connected to; the
   * string is the fact. `postgresql://…@ep-x.neon.tech/…` is Neon whichever
   * button happens to be lit, so the selection follows the string rather than
   * the other way round — and says that it did, since the fields on screen are
   * about to change.
   */
  const applyConnectionString = useCallback(() => {
    const parsed = parseConnectionString(pasted);
    if (parsed.error) {
      setPasteNote(null);
      setProblems([parsed.error]);
      return;
    }

    const switched = parsed.source !== sourceId;
    setSourceId(parsed.source);
    setConfig({ ...defaultConfig(parsed.source), ...parsed.config });
    setProblems([]);
    setPasting(false);
    setPasted('');

    const label = getConnector(parsed.source)?.label || parsed.source;
    setPasteNote(
      switched
        ? `Read as a ${label} connection, and the source above has been switched to match. Check the fields, then save.`
        : 'Filled in from the connection string. Check the fields, then save.'
    );
  }, [pasted, sourceId]);

  const set = (field, value) => setConfig((c) => ({ ...c, [field]: value }));

  const save = async () => {
    const found = validateConfig(sourceId, config);
    if (!name.trim()) found.unshift('Give the connection a name.');
    if (found.length) {
      setProblems(found);
      return;
    }

    setBusy(true);
    setProblems([]);
    try {
      const res = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: organization.id, name: name.trim(), source: sourceId, config }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not save that connection.');
      onSaved(body.connection);
    } catch (e) {
      setProblems([e.message]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="panel slide-in my-auto w-full max-w-2xl p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Add a connection"
      >
        <div className="mb-5 flex items-center gap-3">
          <Database size={16} className="text-accent-400" />
          <h2 className="text-base font-black">Add a connection</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto rounded-lg border border-white/10 p-1.5 text-white/40 hover:bg-white/5 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>

        <div className="mb-5 flex flex-wrap gap-2">
          {CONNECTORS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => choose(c.id)}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                c.id === sourceId
                  ? 'border-accent-500/50 bg-accent-500/10'
                  : 'border-white/10 hover:border-white/25 hover:bg-white/5'
              }`}
            >
              <span className="block text-[12px] font-black text-white/85">{c.label}</span>
              <span className="block text-[9px] font-black uppercase tracking-[0.15em] text-white/30">
                {isAvailable(c) ? 'Available' : 'Planned'}
              </span>
            </button>
          ))}
        </div>

        {connector && (
          <>
            <p className="mb-4 text-[12px] leading-relaxed text-white/40">{connector.blurb}</p>

            {CONNECTION_STRING_EXAMPLES[sourceId] && !pasting && (
              <button
                type="button"
                onClick={() => {
                  setPasting(true);
                  setPasteNote(null);
                }}
                className="mb-4 flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 transition-colors hover:border-accent-500/40 hover:text-white"
              >
                <ClipboardPaste size={13} /> Paste a connection string
              </button>
            )}

            {pasting && (
              <div className="mb-4 flex flex-col gap-2 rounded-xl border border-accent-500/25 bg-accent-500/[0.05] p-3">
                <span className="label">Connection string</span>
                <textarea
                  rows={3}
                  autoFocus
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  placeholder={CONNECTION_STRING_EXAMPLES[sourceId]}
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
                  <span className="ml-auto text-[11px] text-white/30">Nothing is stored until you save.</span>
                </div>
              </div>
            )}

            {pasteNote && (
              <p className="mb-4 rounded-lg border border-accent-500/25 bg-accent-500/8 px-3 py-2 text-[12px] leading-relaxed text-accent-200">
                {pasteNote}
              </p>
            )}

            {connector.oauth && (
              <p className="mb-4 rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2 text-[12px] text-amber-300">
                Fabric signs in with Entra ID rather than a stored password. Saving the endpoint here now
                means only the non-secret half; the sign-in flow arrives with that connector.
              </p>
            )}

            <label className="mb-4 flex flex-col gap-2">
              <span className="label">Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Production warehouse (read-only)"
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-white/85 outline-none placeholder:text-white/20 focus:border-accent-500/50"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              {connector.fields
                // A field tied to a sign-in method is only shown for that
                // method — asking for a private key next to a token field
                // invites filling in both and wondering which one is used.
                .filter(
                  (field) =>
                    !field.requiredWhen ||
                    Object.entries(field.requiredWhen).every(([k, v]) => config[k] === v)
                )
                .map((field) => (
                <label
                  key={field.name}
                  className={`flex flex-col gap-2 ${field.type === 'textarea' ? 'sm:col-span-2' : ''}`}
                >
                  <span className="label flex items-center gap-1.5">
                    {field.label}
                    {field.secret && <Lock size={9} className="text-accent-400/70" />}
                  </span>
                  {field.type === 'boolean' ? (
                    <button
                      type="button"
                      onClick={() => set(field.name, !config[field.name])}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold transition-colors ${
                        config[field.name]
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                          : 'border-white/10 bg-white/5 text-white/45'
                      }`}
                    >
                      {config[field.name] ? <Check size={13} /> : <X size={13} />}
                      {config[field.name] ? 'Yes' : 'No'}
                    </button>
                  ) : field.type === 'select' ? (
                    <select
                      value={config[field.name] ?? ''}
                      onChange={(e) => set(field.name, e.target.value)}
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-white/85 outline-none focus:border-accent-500/50"
                    >
                      {field.options.map((o) => (
                        <option key={o.value} value={o.value} className="bg-surface">
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : field.type === 'textarea' ? (
                    <textarea
                      rows={5}
                      value={config[field.name] ?? ''}
                      placeholder={field.placeholder}
                      spellCheck={false}
                      onChange={(e) => set(field.name, e.target.value)}
                      className="resize-y rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-[11px] leading-relaxed text-white/85 outline-none placeholder:text-white/20 focus:border-accent-500/50"
                    />
                  ) : (
                    <input
                      type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'}
                      value={config[field.name] ?? ''}
                      placeholder={field.placeholder}
                      autoComplete="off"
                      onChange={(e) =>
                        set(field.name, field.type === 'number' ? e.target.value : e.target.value)
                      }
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85 outline-none placeholder:text-white/20 focus:border-accent-500/50"
                    />
                  )}
                </label>
                ))}
            </div>
          </>
        )}

        {problems.length > 0 && (
          <ul className="mt-4 flex flex-col gap-1 rounded-lg border border-rose-500/25 bg-rose-500/8 px-3 py-2">
            {problems.map((p, i) => (
              <li key={i} className="text-[13px] text-rose-300">
                {p}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 flex items-center gap-2">
          <button
            onClick={save}
            disabled={busy}
            className="flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400 disabled:bg-white/10 disabled:text-white/30"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Lock size={13} />}
            {busy ? 'Encrypting' : 'Save to vault'}
          </button>
          <button
            onClick={onClose}
            className="rounded-lg border border-white/10 px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 hover:bg-white/5 hover:text-white"
          >
            Cancel
          </button>
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-white/25">
            <RotateCcw size={11} /> Credentials cannot be read back
          </span>
        </div>
      </div>
    </div>
  );
}
