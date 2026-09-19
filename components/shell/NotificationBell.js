'use client';

/**
 * The bell, and the short list behind it.
 *
 * There is one kind of notification: somebody shared a saved analysis with
 * you. Before this there was no way to find that out — a share appeared
 * silently in the Library, so the only people who knew about one were the
 * people who happened to look, which for anybody who was not already expecting
 * it means nobody.
 *
 * **It never announces a problem.** The route answers with an empty list when
 * this deployment has no accounts, or has them and has not applied the
 * migration, so a bell with nothing in it is the normal state of a perfectly
 * healthy install and there is nothing here that can turn red. A fetch that
 * fails is the same: the previous list stands and the next poll tries again.
 *
 * **Opening it marks everything read**, which is what opening one means. The
 * count clears immediately rather than after the round trip, because a badge
 * that lingers for half a second after you have looked at the thing reads as a
 * badge that did not work; the request behind it can fail without anybody
 * needing to know, and the next poll will put the count back.
 *
 * Polling, not a socket. It is a couple of indexed queries a minute per open
 * tab, it only runs while the tab is in front of somebody, and a share is not
 * an event anybody waits on the way they wait for a message — a minute late is
 * not late.
 *
 * **The menu is drawn in the body, not beside the button.** The sidebar
 * scrolls, so it carries `overflow-x-hidden`, and a panel wider than the rail
 * it hangs off is cut in half by it — which is exactly what happened: the
 * first version had its text sheared at the sidebar's right edge. A portal
 * puts it outside that box, and it is positioned from the button's own
 * rectangle so the rail and the full sidebar need no separate rules.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Bell, Library } from 'lucide-react';
import { badgeLabel, isUnread, relativeTime } from '../../lib/notifications';

/** How often to look, while the tab is in front of somebody. */
const POLL_MS = 60_000;

/** The menu's size, which the placement below has to know before it is drawn. */
const MENU_WIDTH = 320;
const GAP = 8;

/**
 * Where to put the menu, given the button it belongs to.
 *
 * Beside the bell and bottom-aligned with it: the bell lives at the bottom of
 * the sidebar, so a menu that opened downwards would open off the screen, and
 * one that opened to the left would open off the other edge in the rail.
 * Clamped to the viewport in both directions, because a menu nobody can see is
 * the same as no menu.
 */
function placeMenu(button) {
  const rect = button.getBoundingClientRect();
  const left = Math.min(rect.right + GAP, window.innerWidth - MENU_WIDTH - GAP);
  return {
    left: Math.max(GAP, left),
    bottom: Math.max(GAP, window.innerHeight - rect.bottom),
    width: Math.min(MENU_WIDTH, window.innerWidth - 2 * GAP),
  };
}

export default function NotificationBell({ onNavigate }) {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [seenAt, setSeenAt] = useState(null);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState(null);
  const [mounted, setMounted] = useState(false);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);

  // The body is only there after mount, and a portal rendered during the
  // server pass has nothing to render into.
  useEffect(() => setMounted(true), []);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications', { cache: 'no-store' });
      if (!res.ok) return;
      const body = await res.json();
      setItems(Array.isArray(body?.notifications) ? body.notifications : []);
      setUnread(Number(body?.unread) || 0);
      setSeenAt(body?.seenAt || null);
    } catch {
      /* the list on screen stands; the next poll tries again */
    }
  }, []);

  useEffect(() => {
    load();
    const tick = () => {
      // Only while somebody is looking. A tab left open overnight should not
      // spend the night asking.
      if (document.visibilityState === 'visible') load();
    };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load]);

  /**
   * A click anywhere else, or Escape, closes it — the two ways anybody
   * dismisses a menu without hunting for its button again.
   *
   * Both halves are checked by name because they are in different trees now:
   * the panel is portalled into the body, so it is not inside the button's
   * element and a click on it would otherwise read as a click away.
   */
  useEffect(() => {
    if (!open) return undefined;
    const away = (event) => {
      if (panelRef.current?.contains(event.target) || buttonRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const key = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    // A menu positioned from a rectangle has to move when the rectangle does.
    const replace = () => {
      if (buttonRef.current) setPlace(placeMenu(buttonRef.current));
    };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', replace);
    window.addEventListener('scroll', replace, true);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', replace);
      window.removeEventListener('scroll', replace, true);
    };
  }, [open]);

  /**
   * Open or close the menu, and treat opening it as having read the list.
   *
   * The work happens here and not inside a `setOpen` updater, which is where it
   * used to live. A state updater has to be a pure function of the previous
   * state: React is free to call it more than once for a single update, and the
   * POST and the two `setState` calls that were in there would have gone twice.
   * Nothing had misbehaved yet only because `reactStrictMode` is off — which is
   * a setting, not a guarantee.
   *
   * `open` is safe to read directly because this is an event handler: it runs
   * after the render that produced it, so the value is the one the person
   * clicked.
   */
  const toggle = useCallback(() => {
    if (buttonRef.current) setPlace(placeMenu(buttonRef.current));
    const opening = !open;
    setOpen(opening);

    if (opening && unread > 0) {
      // Cleared now rather than when the request comes back: a badge that
      // survives the click that dismissed it looks broken.
      setUnread(0);
      setSeenAt(new Date().toISOString());
      fetch('/api/notifications', { method: 'POST' }).catch(() => {});
    }
  }, [open, unread]);

  const badge = badgeLabel(unread);

  const menu = (
    <div
      ref={panelRef}
      style={place ? { left: place.left, bottom: place.bottom, width: place.width } : undefined}
      className="panel fixed z-[70] flex max-h-[min(26rem,60vh)] flex-col overflow-hidden rounded-xl shadow-2xl"
    >
      <div className="flex items-center gap-2 border-b border-white/8 px-4 py-3">
        <Bell size={12} className="text-accent-400" />
        <span className="label">Notifications</span>
      </div>

      {items.length === 0 ? (
        <p className="px-4 py-6 text-[12px] leading-relaxed text-white/35">
          Nothing yet. When somebody shares an analysis with you, it appears here.
        </p>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {items.map((item) => (
            <li key={item.id}>
              {/* The Library is where a shared analysis is opened from, so that
                  is where the notice goes. */}
              <Link
                href="/library"
                onClick={() => {
                  setOpen(false);
                  onNavigate?.();
                }}
                className="flex items-start gap-3 border-b border-white/5 px-4 py-3 transition-colors last:border-b-0 hover:bg-white/[0.04]"
              >
                <span
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                    isUnread(item, seenAt) ? 'bg-accent-400' : 'bg-transparent'
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] leading-snug text-white/80">{item.message}</span>
                  <span className="mt-1 flex items-center gap-1.5 text-[11px] text-white/35">
                    <Library size={10} />
                    {relativeTime(item.at)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={unread > 0 ? `Notifications, ${unread} new` : 'Notifications'}
        title={unread > 0 ? `${unread} new` : 'Notifications'}
        className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors ${
          open || unread > 0
            ? 'border-accent-500/25 bg-accent-500/12 text-accent-300'
            : 'border-white/10 text-white/45 hover:bg-white/5 hover:text-white'
        }`}
      >
        <Bell size={16} />
        {badge && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-500 px-1 text-[9px] font-black text-on-accent">
            {badge}
          </span>
        )}
      </button>

      {open && mounted && createPortal(menu, document.body)}
    </>
  );
}
