'use client';

/**
 * Settings.
 *
 * Inside the app shell and marked standalone, so it renders before any dataset
 * is loaded — appearance is the one thing somebody might reasonably want to set
 * on arrival. Separate from `/profile`, which is the account. Everything here
 * is kept in this browser.
 */
import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import { Info, Keyboard, Monitor, Palette, ShieldCheck, Sparkles, SwatchBook, Trash2, UserRound } from 'lucide-react';
import PageFrame from '../../../components/shell/PageFrame';
import AppearancePanel from '../../../components/panels/AppearancePanel';
import { ColorThemes, DisplayPrefs } from '../../../components/panels/PreferencesPanel';
import { usePlan } from '../../../lib/store/PlanProvider';
import { clearKey, keySnapshot, serverKeySnapshot, subscribeToKey } from '../../../lib/geminiKey';

const SECTIONS = [
  ['appearance', 'Appearance', Palette],
  ['theme', 'Colour theme', SwatchBook],
  ['display', 'Display', Monitor],
  ['ai', 'AI & assistant', Sparkles],
  ['data', 'Data on this device', ShieldCheck],
  ['shortcuts', 'Keyboard shortcuts', Keyboard],
  ['about', 'About', Info],
];

const SHORTCUTS = [
  [['Ctrl', 'J'], 'Open or close the assistant (⌘ J on a Mac)'],
  [['Esc'], 'Close the assistant or an open panel'],
  [['Enter'], 'Send a message to the assistant'],
  [['Shift', 'Enter'], 'New line in a message'],
  [['←', '→'], 'Previous and next slide in the slideshow'],
];

function Card({ id, icon: Icon, title, subtitle, children }) {
  return (
    <section id={id} className="card group scroll-mt-6 p-6 md:p-7">
      <div className="mb-5 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-accent-400/25 bg-accent-400/10 text-accent-300 transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110">
          <Icon size={16} />
        </span>
        <div>
          <h2 className="text-[16px] font-semibold text-white/90">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[13px] text-white/45">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Kbd({ children }) {
  return <kbd className="rounded-md border border-white/15 bg-white/[0.05] px-1.5 py-0.5 font-mono text-[11px] text-white/75 shadow-[inset_0_-1px_0_rgba(255,255,255,0.08)]">{children}</kbd>;
}

export default function SettingsPage() {
  const ownKey = !!useSyncExternalStore(subscribeToKey, keySnapshot, serverKeySnapshot);
  const { serverModel } = usePlan();
  const [cleared, setCleared] = useState(null);

  const clearLocal = () => {
    if (!window.confirm('Clear the assistant chat, your saved AI key and every display preference in this browser? Saved dashboards on your account are not affected.')) return;
    try {
      clearKey();
      for (const k of Object.keys(window.localStorage)) if (k.startsWith('insight.')) window.localStorage.removeItem(k);
      for (const k of Object.keys(window.sessionStorage)) if (k.startsWith('insight.')) window.sessionStorage.removeItem(k);
      setCleared('Cleared. Reloading…');
      setTimeout(() => window.location.reload(), 600);
    } catch {
      setCleared('This browser blocked access to its storage.');
    }
  };

  return (
    <PageFrame title="Settings" subtitle="How the app looks and behaves on this device.">
      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="hidden lg:block" aria-label="Settings sections">
          <ul className="stagger-fast sticky top-6 space-y-0.5">
            {SECTIONS.map(([id, label, Icon]) => (
              <li key={id}>
                <a href={`#${id}`} className="group flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-white/55 transition-colors hover:translate-x-0.5 hover:bg-white/[0.04] hover:text-white/90">
                  <Icon size={14} className="text-white/35 transition-colors group-hover:text-accent-400" /> {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="stagger min-w-0 space-y-5">
          <Card id="appearance" icon={Palette} title="Appearance" subtitle="Lighting and the material panels are made of.">
            <AppearancePanel />
          </Card>

          <Card id="theme" icon={SwatchBook} title="Colour theme" subtitle="The accent across buttons, highlights, glows and the landing page. Chart colours stay fixed so a series never changes meaning.">
            <ColorThemes />
          </Card>

          <Card id="display" icon={Monitor} title="Display">
            <DisplayPrefs />
          </Card>

          <Card id="ai" icon={Sparkles} title="AI & assistant" subtitle="Every number is computed from your rows either way. A model only helps read columns and write words.">
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/8 bg-white/[0.02] p-4">
              <span className={`h-2 w-2 rounded-full ${ownKey || serverModel ? 'bg-emerald-400' : 'bg-white/30'}`} />
              <p className="min-w-0 flex-1 text-[13px] text-white/70">
                {ownKey ? 'Using your own AI key in this browser.' : serverModel ? 'Using the AI included with your plan.' : 'No AI in use — the assistant works in built-in mode.'}
              </p>
              <Link href="/home#model-key" className="rounded-lg border border-white/10 px-3 py-1.5 text-[12px] font-semibold text-white/65 hover:bg-white/5 hover:text-white">
                {ownKey ? 'Manage key' : 'Add a key'}
              </Link>
            </div>
            <p className="mt-3 text-[12.5px] leading-relaxed text-white/45">
              The assistant opens from the button at the bottom right of every page. It shows every change before making it, and each one can be undone.
            </p>
          </Card>

          <Card id="data" icon={ShieldCheck} title="Data on this device" subtitle="Files are parsed and analysed in this browser. Nothing is uploaded without a model key.">
            <div className="flex flex-wrap items-center gap-3">
              <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-white/60">
                Clear the assistant chat, your saved AI key and all display preferences from this browser.
              </p>
              <button type="button" onClick={clearLocal} className="flex items-center gap-2 rounded-lg border border-rose-500/30 px-3.5 py-2 text-[12.5px] font-semibold text-rose-300 transition-colors hover:bg-rose-500/10">
                <Trash2 size={14} /> Clear local data
              </button>
            </div>
            {cleared && <p className="mt-3 text-[12.5px] text-white/55">{cleared}</p>}
            <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-white/6 pt-5">
              <UserRound size={16} className="text-white/35" />
              <p className="min-w-0 flex-1 text-[13px] text-white/55">Your account, saved analyses and stored connections live on your profile.</p>
              <Link href="/profile" className="rounded-lg border border-white/10 px-3.5 py-2 text-[12.5px] font-semibold text-white/65 hover:bg-white/5 hover:text-white">
                Open profile
              </Link>
            </div>
          </Card>

          <Card id="shortcuts" icon={Keyboard} title="Keyboard shortcuts">
            <ul className="divide-y divide-white/6">
              {SHORTCUTS.map(([keys, what]) => (
                <li key={what} className="flex items-center gap-4 py-2.5">
                  <span className="flex w-32 shrink-0 gap-1">
                    {keys.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </span>
                  <span className="text-[13px] text-white/65">{what}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card id="about" icon={Info} title="About">
            <dl className="grid gap-x-8 gap-y-3 text-[13px] sm:grid-cols-2">
              <div>
                <dt className="label">Product</dt>
                <dd className="mt-1 text-white/80">Insight Executive</dd>
              </div>
              <div>
                <dt className="label">Version</dt>
                <dd className="mt-1 font-mono text-white/80">1.0.0</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="label">How it works</dt>
                <dd className="mt-1 leading-relaxed text-white/60">
                  The engine reads each column, derives the measures an analyst would use and plans the dashboard from what the data shows.
                  Every figure on screen is computed from your rows.
                </dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>
    </PageFrame>
  );
}
