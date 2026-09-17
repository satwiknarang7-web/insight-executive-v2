'use client';

/**
 * Settings.
 *
 * Inside the app shell and marked standalone, so it renders before any dataset
 * is loaded — appearance is the one thing somebody might reasonably want to set
 * on arrival, and sending them to Home to load a spreadsheet first would be an
 * odd way to ask.
 *
 * Deliberately separate from `/profile`, which is the account: who you are,
 * what you saved, which credentials you stored. None of that exists on a
 * deployment without Supabase, and this does.
 */
import Link from 'next/link';
import { Compass, Palette, UserRound } from 'lucide-react';
import PageFrame from '../../../components/shell/PageFrame';
import AppearancePanel from '../../../components/panels/AppearancePanel';
import { useTutorial } from '../../../lib/store/TutorialProvider';

export default function SettingsPage() {
  const { start: startTutorial } = useTutorial();

  return (
    <PageFrame title="Settings" subtitle="How the app looks on this device.">
      <section className="card p-6 md:p-7">
        <div className="mb-5 flex items-center gap-2.5">
          <Palette size={16} className="text-accent-400" />
          <h2 className="text-base font-bold text-white/90">Appearance</h2>
        </div>
        <AppearancePanel />
        <p className="mt-6 border-t border-white/6 pt-4 text-[12px] leading-relaxed text-white/35">
          Kept in this browser, not on your account, so a shared machine does not carry your choice to
          the next person and a private window starts from the default.
        </p>
      </section>

      {/*
        * The guided tour lives here now rather than in the sidebar footer.
        * It is something you choose to do once, which is a setting, not one of
        * the two actions worth a permanent place beside the navigation.
        */}
      <section className="card mt-4 flex flex-wrap items-center gap-3 p-5">
        <Compass size={16} className="text-white/30" />
        <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-white/45">
          A guided tour of the app, from loading a file to presenting the findings.
        </p>
        <button
          type="button"
          onClick={() => startTutorial()}
          className="rounded-xl border border-white/10 px-4 py-2 text-[12px] font-semibold text-white/60 transition-colors hover:bg-white/5 hover:text-white"
        >
          Take the tour
        </button>
      </section>

      <section className="card mt-4 flex flex-wrap items-center gap-3 p-5">
        <UserRound size={16} className="text-white/30" />
        <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-white/45">
          Your account, saved analyses and stored connections live on your profile.
        </p>
        <Link
          href="/profile"
          className="rounded-xl border border-white/10 px-4 py-2 text-[12px] font-semibold text-white/60 transition-colors hover:bg-white/5 hover:text-white"
        >
          Open profile
        </Link>
      </section>
    </PageFrame>
  );
}
