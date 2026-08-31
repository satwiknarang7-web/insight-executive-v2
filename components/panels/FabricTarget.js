'use client';

/**
 * Choosing what a Fabric connection points at.
 *
 * Fabric is the one source whose target cannot be asked for on the form. A SQL
 * analytics endpoint is a generated hostname, different for every warehouse and
 * lakehouse and buried several clicks into the portal; asking for it made the
 * connection form look like it wanted a database administrator. The three
 * application fields are enough to go and *list* everything the service
 * principal can read, so that is what happens here, after those three are saved
 * and have been proven to work.
 *
 * Until something is chosen the connection is deliberately unusable — the
 * driver refuses every query with "choose a warehouse or lakehouse first"
 * rather than dialling an empty hostname. This is the screen that fixes that,
 * and it is the only thing standing between a saved credential and a usable
 * connection, so it says what it is doing at every step rather than spinning.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Database, Loader2, RefreshCw, Warehouse } from 'lucide-react';

export default function FabricTarget({ organization, connection, onChosen }) {
  const [items, setItems] = useState(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState('load'); // 'load' | 'save' | null
  const [error, setError] = useState(null);

  const current = connection?.config?.itemId || null;

  const discover = useCallback(async () => {
    setBusy('load');
    setError(null);
    try {
      const res = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'catalog', orgId: organization.id, connectionId: connection.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'That catalog could not be read.');
      setItems(body.items || []);
      // Keep whatever is already chosen; otherwise open on the first item.
      setSelected((prev) => prev || current || body.items?.[0]?.id || '');
    } catch (e) {
      setError(e.message);
      setItems([]);
    } finally {
      setBusy(null);
    }
  }, [organization.id, connection.id, current]);

  useEffect(() => {
    discover();
  }, [discover]);

  const choose = useCallback(async () => {
    const item = (items || []).find((i) => i.id === selected);
    if (!item) return;
    setBusy('save');
    setError(null);
    try {
      const res = await fetch(
        `/api/connections/${connection.id}?org=${encodeURIComponent(organization.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item }),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'That choice could not be saved.');
      onChosen?.(body.connection);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }, [items, selected, connection.id, organization.id, onChosen]);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-accent-500/25 bg-accent-500/[0.05] p-4">
      <div className="flex items-center gap-2">
        <Warehouse size={14} className="text-accent-400" />
        <span className="label">Warehouse or lakehouse</span>
        {items !== null && !busy && (
          <button
            type="button"
            onClick={discover}
            title="Look again"
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.15em] text-white/45 transition-colors hover:bg-white/5 hover:text-white"
          >
            <RefreshCw size={11} /> Refresh
          </button>
        )}
      </div>

      {busy === 'load' && (
        <p className="flex items-center gap-2 text-[13px] text-white/45">
          <Loader2 size={13} className="animate-spin" /> Signing in and listing what this application can
          reach…
        </p>
      )}

      {error && (
        <p className="flex items-start gap-2 rounded-lg border border-rose-500/25 bg-rose-500/8 px-3 py-2 text-[12px] leading-relaxed text-rose-300">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      {items !== null && items.length === 0 && !error && (
        <p className="text-[13px] leading-relaxed text-white/50">
          The application signed in but can reach no warehouse or lakehouse. Grant the service principal
          access to a Fabric workspace, then press Refresh.
        </p>
      )}

      {items !== null && items.length > 0 && (
        <>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-white/85 outline-none focus:border-accent-500/50"
          >
            {items.map((item) => (
              <option key={item.id} value={item.id} className="bg-surface">
                {item.workspaceName ? `${item.workspaceName} · ` : ''}
                {item.name}
                {item.kind === 'lakehouse' ? ' (lakehouse)' : ''}
              </option>
            ))}
          </select>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={choose}
              disabled={!selected || busy === 'save'}
              className="flex items-center gap-2 rounded-lg bg-accent-500 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400 disabled:opacity-40"
            >
              {busy === 'save' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              {current ? 'Change target' : 'Use this one'}
            </button>
            <span className="flex items-center gap-1.5 text-[11px] text-white/30">
              <Database size={11} /> {items.length} available
            </span>
          </div>
        </>
      )}
    </div>
  );
}
