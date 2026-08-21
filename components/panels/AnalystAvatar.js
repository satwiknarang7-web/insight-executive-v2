'use client';

/**
 * An analyst avatar's portrait.
 *
 * Renders the photograph at `avatar.portrait` when that file exists in
 * /public/avatars, and falls back to a generated portrait otherwise — so the app
 * ships and runs with no binary assets, and adding real photography later is
 * purely a matter of dropping four files in place.
 *
 * While speaking, a ring pulses around the portrait. That is deliberately driven
 * by the `speaking` prop rather than by audio analysis: the Web Speech API gives
 * no output stream to analyse, and a fake waveform would imply a precision the
 * component does not have.
 */
import { useEffect, useState } from 'react';

export default function AnalystAvatar({ avatar, size = 64, speaking = false, muted = false }) {
  const [broken, setBroken] = useState(false);

  // A different avatar means a different image; give it a fresh chance to load.
  useEffect(() => setBroken(false), [avatar.id]);

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      {speaking && (
        <>
          <span
            className="absolute inset-0 animate-ping rounded-full opacity-40"
            style={{ backgroundColor: avatar.accent, animationDuration: '1.6s' }}
            aria-hidden
          />
          <span
            className="absolute rounded-full"
            style={{ inset: -3, border: `2px solid ${avatar.accent}`, opacity: 0.7 }}
            aria-hidden
          />
        </>
      )}

      <span
        className="relative overflow-hidden rounded-full ring-1 ring-white/15"
        style={{ width: size, height: size, backgroundColor: 'var(--surface)' }}
      >
        {!broken && avatar.portrait ? (
          <img
            src={avatar.portrait}
            alt={`${avatar.name}, ${avatar.role}`}
            width={size}
            height={size}
            onError={() => setBroken(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <GeneratedPortrait avatar={avatar} size={size} />
        )}
      </span>

      {muted && (
        <span
          className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-surface text-[8px] ring-1 ring-white/15"
          title="Muted"
          aria-hidden
        >
          🔇
        </span>
      )}
    </span>
  );
}

/**
 * A generated portrait: a soft gradient ground with an abstract head-and-
 * shoulders silhouette, tinted by the avatar's accent. Distinct per avatar
 * without pretending to be a photograph of a person who does not exist.
 */
function GeneratedPortrait({ avatar, size }) {
  const id = `pt-${avatar.id}`;
  // Small per-avatar variations so the four are visually distinguishable.
  const shape = {
    strategist: { headR: 15, shoulder: 30, tilt: 0 },
    analyst: { headR: 14, shoulder: 32, tilt: -3 },
    storyteller: { headR: 16, shoulder: 28, tilt: 4 },
    coach: { headR: 15, shoulder: 34, tilt: 2 },
  }[avatar.id] || { headR: 15, shoulder: 30, tilt: 0 };

  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`${avatar.name}, ${avatar.role}`}>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={avatar.accent} stopOpacity="0.35" />
          <stop offset="100%" stopColor={avatar.accent} stopOpacity="0.08" />
        </linearGradient>
        <linearGradient id={`${id}-fg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={avatar.accent} />
          <stop offset="100%" stopColor={avatar.accent} stopOpacity="0.55" />
        </linearGradient>
      </defs>

      <rect width="100" height="100" fill={`url(#${id}-bg)`} />
      <g transform={`rotate(${shape.tilt} 50 50)`}>
        <circle cx="50" cy={38 - shape.headR * 0.1} r={shape.headR} fill={`url(#${id}-fg)`} />
        <path
          d={`M ${50 - shape.shoulder} 100 Q 50 ${100 - shape.shoulder * 1.5} ${50 + shape.shoulder} 100 Z`}
          fill={`url(#${id}-fg)`}
        />
      </g>
    </svg>
  );
}
