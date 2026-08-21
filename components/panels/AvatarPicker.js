'use client';

/**
 * Choosing who presents the deck.
 *
 * The choice is a presentation preference, not part of the analysis, so it is
 * kept in localStorage rather than in the session state or IndexedDB — it should
 * outlive the dataset and follow the user to their next upload.
 */
import { useCallback, useEffect, useState } from 'react';
import { AVATARS, DEFAULT_AVATAR_ID, getAvatar } from '../../lib/avatars';
import AnalystAvatar from './AnalystAvatar';

const STORAGE_KEY = 'insight.avatar';

/** The selected avatar, persisted across sessions. */
export function useAvatar() {
  const [id, setId] = useState(DEFAULT_AVATAR_ID);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved && AVATARS.some((a) => a.id === saved)) setId(saved);
    } catch {
      /* private browsing — the default is fine */
    }
  }, []);

  const choose = useCallback((next) => {
    setId(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* not persisting is survivable */
    }
  }, []);

  return { avatar: getAvatar(id), avatarId: id, chooseAvatar: choose };
}

export default function AvatarPicker({ selectedId, onSelect, compact = false }) {
  return (
    <div
      className={compact ? 'flex flex-wrap gap-2' : 'grid gap-3 sm:grid-cols-2'}
      role="radiogroup"
      aria-label="Choose your presenter"
    >
      {AVATARS.map((a) => {
        const active = a.id === selectedId;
        return (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onSelect(a.id)}
            className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition-colors ${
              active
                ? 'border-accent-500/50 bg-accent-500/8'
                : 'border-white/8 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]'
            }`}
            style={active ? { borderColor: `${a.accent}80`, backgroundColor: `${a.accent}14` } : undefined}
          >
            <AnalystAvatar avatar={a} size={compact ? 36 : 48} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-black text-white/90">{a.name}</span>
              <span className="block truncate text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: a.accent }}>
                {a.role}
              </span>
              {!compact && (
                <span className="mt-1 block text-[11px] leading-relaxed text-white/40">{a.blurb}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
