/**
 * A small chart assembling itself: bars rising in a wave and a trend line
 * drawing across them. Decorative — the words beside it say what is happening.
 * Colours come from the accent tokens, so it follows the theme.
 */
const BARS = [0.45, 0.7, 0.55, 0.85, 0.62, 0.95, 0.78];
const LINE = [0.62, 0.5, 0.56, 0.36, 0.44, 0.22, 0.28];

export default function ChartPulse({ size = 96, className = '' }) {
  const w = 120;
  const h = 72;
  const base = 64;
  const step = w / BARS.length;
  const bw = step * 0.56;
  const pts = LINE.map((y, i) => [step * i + step / 2, 8 + y * 48]);
  const last = pts.at(-1);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={size} height={(size * h) / w} className={className} aria-hidden="true" focusable="false">
      {[20, 40].map((y) => (
        <line key={y} x1="0" x2={w} y1={y} y2={y} stroke="currentColor" strokeOpacity="0.08" strokeDasharray="2 3" />
      ))}
      <line x1="0" x2={w} y1={base + 0.5} y2={base + 0.5} stroke="currentColor" strokeOpacity="0.18" />
      {BARS.map((v, i) => (
        <rect
          key={i}
          className="ld-bar"
          x={step * i + (step - bw) / 2}
          y={base - v * 52}
          width={bw}
          height={v * 52}
          rx="2.5"
          fill="var(--color-accent-400)"
          fillOpacity={0.22 + (i / BARS.length) * 0.3}
          style={{ animationDelay: `${i * 0.12}s` }}
        />
      ))}
      <polyline
        className="ld-line"
        pathLength="1"
        points={pts.map((p) => p.join(',')).join(' ')}
        fill="none"
        stroke="var(--color-accent-300)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle className="ld-dot" cx={last[0]} cy={last[1]} r="3.4" fill="var(--color-accent-300)" />
    </svg>
  );
}
