'use client';

/**
 * Shared page header and max-width container, used by every app page.
 *
 * The title is set in the display serif rather than in the same geometric sans
 * as the buttons beside it. That one difference is most of what separates a
 * page that was designed from a page that was assembled: a heading needs to be
 * a different *voice*, not the same voice louder, and `font-black` at a larger
 * size is only ever the same voice louder.
 *
 * It is also where a page arrives. Every app page renders one, and each route
 * mounts it afresh, so the title, the subtitle, the actions and then the body
 * rise in one after another on every navigation without any page asking.
 */
export default function PageFrame({ title, subtitle, action, children }) {
  return (
    <div className="mx-auto w-full max-w-[1500px] px-5 py-8 md:px-8 md:py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="display anim-rise text-[27px] leading-[1.12] text-white/95 md:text-[34px]">{title}</h1>
          {subtitle && (
            <p className="anim-rise mt-1.5 truncate text-[13px] text-white/45" style={{ animationDelay: '60ms' }}>{subtitle}</p>
          )}
        </div>
        {action && (
          <div className="anim-fade" style={{ animationDelay: '120ms' }}>
            {action}
          </div>
        )}
      </header>
      <div className="anim-rise" style={{ animationDelay: '100ms' }}>
        {children}
      </div>
    </div>
  );
}
