'use client';

/**
 * A figure that counts up to itself, the way a query result arrives.
 *
 * It takes the string the engine already formatted — "1.4M", "$894.7K",
 * "−3.2%", "1,943" — rather than a raw number, because the formatting is the
 * engine's decision and must not be re-made here. The one number in the string
 * is animated with the same decimals and the same grouping, and whatever sits
 * either side of it (a currency, a unit, a sign) stays put. When the figure
 * changes — a filter applied — it runs from the old value to the new one
 * rather than from zero.
 *
 * Anything that is not exactly one number is shown as it is: "2023–2025"
 * counting from "0–2025" would be a wrong figure on screen, however briefly.
 * So is everything under reduced motion and in print, and the server renders
 * the final text, so a figure is never wrong for anyone not watching it count.
 */

import { useLayoutEffect, useRef } from 'react';
import { motionAllowed } from '../../lib/motion';

const ONE_NUMBER = /^([^\d]*?)([−-]?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?([^\d]*)$/;

/** The parts of a formatted figure, or null when it is not a single number. */
export function parseFigure(text) {
  const m = ONE_NUMBER.exec(String(text ?? ''));
  if (!m) return null;
  const [, prefix, sign, whole, frac = '', suffix] = m;
  const value = Number(`${whole.replace(/,/g, '')}${frac}`);
  if (!Number.isFinite(value)) return null;
  return { prefix, sign, value, decimals: frac ? frac.length - 1 : 0, grouped: whole.includes(','), suffix };
}

function render(fig, v) {
  const [int, dec] = v.toFixed(fig.decimals).split('.');
  const whole = fig.grouped ? int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : int;
  return `${fig.prefix}${fig.sign}${whole}${dec ? `.${dec}` : ''}${fig.suffix}`;
}

/** Same unit and sign either side, so counting between the two means something. */
const sameShape = (a, b) => a && b && a.prefix === b.prefix && a.suffix === b.suffix && a.sign === b.sign;

export default function CountUp({ value, duration = 1100, delay = 0, animate = true, className = '', style }) {
  const text = String(value ?? '');
  const ref = useRef(null);
  const last = useRef(null);

  /*
   * The count is written straight into the text node React rendered, not
   * through state: sixty re-renders a second for a number is sixty wasted
   * reconciliations. It edits React's own node rather than replacing it, so
   * when the figure changes React updates that same node and nothing goes
   * stale. React always rendered the final text, and every path below ends by
   * putting it back.
   *
   * A layout effect, so the starting value replaces the final one before the
   * browser paints either — no flash of the answer before the count.
   */
  useLayoutEffect(() => {
    const node = ref.current?.firstChild;
    const put = (s) => {
      if (node && node.nodeType === 3 && node.nodeValue !== s) node.nodeValue = s;
    };
    const fig = parseFigure(text);
    const prev = last.current;
    last.current = fig;
    const from = sameShape(prev, fig) ? prev.value : 0;
    if (!animate || !fig || !motionAllowed() || from === fig.value) {
      put(text);
      return undefined;
    }
    let raf = 0;
    let start = 0;
    let done = false;
    const tick = (now) => {
      if (!start) start = now + delay;
      const k = Math.min(1, Math.max(0, (now - start) / duration));
      done = k >= 1;
      put(done ? text : render(fig, from + (fig.value - from) * (1 - (1 - k) ** 3)));
      if (!done) raf = requestAnimationFrame(tick);
    };
    put(render(fig, from));
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      // Interrupted before it landed: the next count starts from zero rather
      // than from a figure that was never finished on screen.
      if (!done) last.current = null;
    };
  }, [text, animate, duration, delay]);

  return (
    <span ref={ref} className={className} style={style}>
      {text}
    </span>
  );
}
