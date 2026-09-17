'use client';

/**
 * Choosing how the app looks.
 *
 * Two questions, kept apart because they are answered for different reasons.
 * The lighting is about the room somebody is sitting in. The material is about
 * what they want a panel to be made of, and it is the one worth previewing:
 * three words — glass, clay, neumorphic — mean nothing until you can see what
 * each does to a card.
 *
 * So each option renders the material itself rather than a name and a radio
 * button, on the ground that material actually uses, in the lighting currently
 * chosen. Picking one applies it immediately and to the whole app: there is no
 * Save, because the preview *is* the thing and a confirmation step would only
 * stand between somebody and the answer.
 */
import { useCallback, useEffect, useState } from 'react';
import { Check, Moon, Sun } from 'lucide-react';
import {
  MODES,
  SURFACES,
  applyAppearance,
  currentAppearance,
  normalizeAppearance,
} from '../../lib/appearance';

export default function AppearancePanel() {
  // Server-rendered as the default, then corrected on mount from whatever the
  // blocking script applied. Rendering the stored value on the server is not
  // possible — it lives in localStorage — and guessing would mismatch.
  const [appearance, setAppearance] = useState(() => normalizeAppearance({}));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setAppearance(currentAppearance());
    setReady(true);
    const follow = (event) => setAppearance(normalizeAppearance(event.detail || currentAppearance()));
    window.addEventListener('insight:appearance', follow);
    return () => window.removeEventListener('insight:appearance', follow);
  }, []);

  const choose = useCallback((patch) => {
    setAppearance(applyAppearance({ ...currentAppearance(), ...patch }));
  }, []);

  return (
    <div className="flex flex-col gap-7">
      <section>
        <h3 className="label mb-1">Lighting</h3>
        <p className="mb-3 text-[13px] leading-relaxed text-white/45">
          Dark is the default. Light is the one that prints.
        </p>
        <div className="flex flex-wrap gap-2">
          {MODES.map((m) => {
            const Icon = m.id === 'light' ? Sun : Moon;
            const active = ready && appearance.mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => choose({ mode: m.id })}
                aria-pressed={active}
                title={m.blurb}
                className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[13px] font-semibold transition-colors ${
                  active
                    ? 'border-accent-500/45 bg-accent-500/10 text-accent-300'
                    : 'border-white/10 text-white/55 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon size={14} />
                {m.label}
                {active && <Check size={13} className="text-accent-400" />}
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="label mb-1">Material</h3>
        <p className="mb-3 text-[13px] leading-relaxed text-white/45">
          What a panel is made of. It changes nothing about what the numbers say — only how the
          surfaces holding them are built.
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          {SURFACES.map((s) => {
            const active = ready && appearance.surface === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => choose({ surface: s.id })}
                aria-pressed={active}
                className={`group rounded-2xl border p-3 text-left transition-colors ${
                  active
                    ? 'border-accent-500/45 bg-accent-500/[0.06]'
                    : 'border-white/10 hover:border-accent-500/25 hover:bg-white/[0.03]'
                }`}
              >
                {/* The material, on the ground it actually sits on. */}
                <span className="swatch-ground block" data-preview={s.id}>
                  <span className="swatch block text-white" data-preview={s.id}>
                    <span className="swatch-bar block" />
                    <span className="swatch-bar block" />
                  </span>
                </span>

                <span className="mt-3 flex items-center gap-1.5">
                  <span className={`text-[13px] font-bold ${active ? 'text-accent-300' : 'text-white/85'}`}>
                    {s.label}
                  </span>
                  {active && <Check size={13} className="text-accent-400" />}
                </span>
                <span className="mt-1 block text-[11px] leading-relaxed text-white/40">{s.blurb}</span>
              </button>
            );
          })}
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-white/30">
          {SURFACES.find((s) => s.id === appearance.surface)?.detail}
        </p>
      </section>
    </div>
  );
}
