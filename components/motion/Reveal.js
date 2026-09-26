'use client';

/**
 * A block that rises into place as it is scrolled to.
 *
 * It renders visible and is hidden by script, never the other way round: a
 * section that starts at opacity 0 in the stylesheet and waits for JavaScript
 * is silently missing whenever that JavaScript does not run. The hiding is an
 * attribute React does not own, so a re-render cannot wipe it half way, and a
 * floor timer shows it anyway if the observer never reports at all — a broken
 * observer must not leave a page blank.
 */

import { useEffect, useRef } from 'react';
import { motionAllowed } from '../../lib/motion';

export default function Reveal({ as: Tag = 'div', delay = 0, className = '', style, children, ...rest }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined' || !motionAllowed()) return undefined;
    // Already on screen at mount: leave it alone rather than blink it.
    const box = el.getBoundingClientRect();
    if (box.top < window.innerHeight * 0.9 && box.bottom > 0) return undefined;

    el.setAttribute('data-reveal', 'hidden');
    const show = () => el.setAttribute('data-reveal', 'shown');
    let floor = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        // An observer reports once as soon as it starts watching. Having heard
        // from it, the floor is no longer needed: it is alive and will say when.
        clearTimeout(floor);
        if (entries.some((e) => e.isIntersecting)) {
          show();
          observer.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    );
    floor = setTimeout(show, 3000);
    observer.observe(el);
    return () => {
      clearTimeout(floor);
      observer.disconnect();
      el.removeAttribute('data-reveal');
    };
  }, []);

  return (
    <Tag ref={ref} className={`reveal ${className}`} style={delay ? { ...style, transitionDelay: `${delay}ms` } : style} {...rest}>
      {children}
    </Tag>
  );
}
