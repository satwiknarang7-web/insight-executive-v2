'use client';

/**
 * One slide of the slideshow: the summary (page 0) or one chart with its
 * sentence (every page after).
 *
 * Shared by the live slideshow and the video export, so a downloaded video
 * shows exactly the slides the room saw. Two differences are props rather
 * than copies:
 *
 *  - `animate` off draws every chart, count and entrance finished, which is
 *    what a frame captured for a video has to be.
 *  - `wide` fixes the side-by-side layout. The live page follows the window's
 *    breakpoints, but a video frame is always 16:9 whatever the window it was
 *    made in, so it must not fall back to the phone layout on a phone.
 */

import TileChart from '../dashboard/TileChart';
import KpiStrip from '../dashboard/KpiStrip';
import AnalystAvatar from '../panels/AnalystAvatar';

export default function SlideContent({ board, page, tiles, measures, fields, avatar, height, animate = true, wide = false }) {
  const bullets = board.aiSummary?.length ? board.aiSummary : (board.findings || []).map((f) => f.text);

  if (page === 0) {
    return (
      <div className={`mx-auto max-w-6xl ${wide ? 'space-y-9' : 'space-y-7'}`}>
        <div className={animate ? 'anim-rise' : ''}>
          <span className="eyebrow">
            {bullets.length} key {bullets.length === 1 ? 'finding' : 'findings'} · {tiles.length} {tiles.length === 1 ? 'chart' : 'charts'}
          </span>
          <h1 className={`display mt-4 max-w-4xl leading-[1.12] text-white/95 ${wide ? 'text-[48px]' : 'text-[30px] sm:text-[44px]'}`}>
            {board.headline || board.subject || 'What the data says'}
          </h1>
          {board.filterNote && (
            <p className="mt-4 inline-flex items-center gap-2 rounded-lg border border-accent-400/35 bg-accent-400/10 px-3 py-1.5 text-[13px] font-medium text-accent-300" data-testid="present-filter">
              Filtered to {board.filterNote}
            </p>
          )}
        </div>
        {bullets.length > 0 && (
          <ol className={`${animate ? 'stagger' : ''} grid gap-3 ${wide ? 'grid-cols-2' : 'md:grid-cols-2'}`}>
            {bullets.slice(0, 4).map((b, i) => (
              <li key={i} className="card flex gap-3 p-4">
                <span className="figure flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-accent-400/30 bg-accent-400/10 text-[13px] font-semibold text-accent-300">{i + 1}</span>
                <span className={`leading-relaxed text-white/85 ${wide ? 'text-[17px]' : 'text-[15px]'}`}>{b}</span>
              </li>
            ))}
          </ol>
        )}
        <KpiStrip kpis={board.kpis} animate={animate} />
      </div>
    );
  }

  const tile = tiles[page - 1];
  if (!tile) return null;
  return (
    <div className={`grid min-h-0 gap-4 ${wide ? 'grid-cols-[minmax(0,1fr)_340px] items-stretch' : 'lg:grid-cols-[minmax(0,1fr)_300px] lg:items-stretch'}`}>
      <div className="card flex min-h-0 flex-col p-5 sm:p-6">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.08em] text-white/40">Fig. {page}</span>
          <h2 className={`font-semibold leading-snug text-white/95 ${wide ? 'text-[28px]' : 'text-[20px] sm:text-[26px]'}`}>{tile.title}</h2>
        </div>
        <div className="min-w-0">
          <TileChart tile={tile} measures={measures} fields={fields} height={height} animate={animate} />
        </div>
      </div>
      {tile.insight && (
        <div
          className={`${animate ? 'anim-slide-right' : ''} flex gap-3 rounded-2xl border border-accent-400/25 bg-accent-400/[0.06] p-4 sm:p-5 ${
            wide ? 'flex-col self-center' : 'items-start lg:flex-col lg:self-center'
          }`}
          style={animate ? { animationDelay: '220ms' } : undefined}
        >
          <AnalystAvatar avatar={avatar} size={32} />
          <p className={`leading-relaxed text-white/85 ${wide ? 'text-[19px]' : 'text-[15px] sm:text-[17px]'}`}>{tile.insight}</p>
        </div>
      )}
    </div>
  );
}
