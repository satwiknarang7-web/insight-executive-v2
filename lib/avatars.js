/**
 * The four analyst avatars.
 *
 * An avatar is a presenter, not a skin: it picks a voice, and it rewrites the
 * same verified findings in its own register. The numbers never change — only
 * the framing around them — because the whole product rests on the statistics
 * being computed before any language is put near them.
 *
 * `portrait` points at an optional image in /public/avatars. When the file is
 * absent the UI falls back to the generated portrait, so the app ships working
 * with no binary assets and photographs can be dropped in later without a code
 * change.
 */

export const AVATARS = [
  {
    id: 'strategist',
    name: 'Nadia Reyes',
    role: 'The Strategist',
    blurb: 'Frames every number as a decision. Opens with the implication, not the metric.',
    accent: '#14b8a6',
    portrait: '/avatars/strategist.jpg',
    // Voice shaping for the Web Speech API. `match` biases voice selection
    // toward a system voice whose name contains one of these.
    voice: { pitch: 0.95, rate: 0.95, match: ['samantha', 'aria', 'jenny', 'female'] },
    register: {
      open: (title) => `Let's talk about ${lower(title)}.`,
      lead: 'Here is what matters:',
      bridge: 'The reason this matters:',
      close: 'The decision in front of us:',
    },
  },
  {
    id: 'analyst',
    name: 'Marcus Oyelaran',
    role: 'The Analyst',
    blurb: 'Precise and numbers-led. States the figure, the method, then the caveat.',
    accent: '#6366f1',
    portrait: '/avatars/analyst.jpg',
    voice: { pitch: 0.85, rate: 1.05, match: ['daniel', 'guy', 'david', 'male'] },
    register: {
      open: (title) => `${title}.`,
      lead: 'The measurement:',
      bridge: 'Breaking that down:',
      close: 'Worth verifying next:',
    },
  },
  {
    id: 'storyteller',
    name: 'Priya Raman',
    role: 'The Storyteller',
    blurb: 'Builds a narrative arc across the deck. Good for an audience that is not close to the data.',
    accent: '#f59e0b',
    portrait: '/avatars/storyteller.jpg',
    voice: { pitch: 1.1, rate: 0.9, match: ['karen', 'moira', 'libby', 'female'] },
    register: {
      open: (title) => `Now, ${lower(title)} — this one tells a story.`,
      lead: 'What we found:',
      bridge: 'And here is the interesting part:',
      close: 'Which leaves us with a question:',
    },
  },
  {
    id: 'coach',
    name: 'Tom Baxter',
    role: 'The Coach',
    blurb: 'Action-oriented. Every slide ends with something to actually do.',
    accent: '#f43f5e',
    portrait: '/avatars/coach.jpg',
    voice: { pitch: 1.0, rate: 1.1, match: ['alex', 'fred', 'mark', 'male'] },
    register: {
      open: (title) => `Right — ${lower(title)}.`,
      lead: 'Straight to it:',
      bridge: 'What that means for us:',
      close: 'So here is the next move:',
    },
  },
];

export const DEFAULT_AVATAR_ID = 'strategist';

/** Look up an avatar, always returning one. */
export function getAvatar(id) {
  return AVATARS.find((a) => a.id === id) || AVATARS[0];
}

const lower = (s) => {
  const t = String(s || '').trim();
  // Leave acronyms and proper nouns alone; only drop a leading capital from an
  // ordinary word so "Revenue by Region" reads naturally mid-sentence.
  if (!t || t.length < 2) return t;
  return /^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t;
};
