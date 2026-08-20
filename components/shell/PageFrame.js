'use client';

/** Shared page header + max-width container used by every app page. */
export default function PageFrame({ title, subtitle, action, children }) {
  return (
    <div className="mx-auto w-full max-w-[1500px] px-5 py-8 md:px-8 md:py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-black tracking-tight md:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 truncate text-sm text-white/40">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </div>
  );
}
