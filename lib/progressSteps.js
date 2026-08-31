/**
 * What the engine is going to do, so the panel can say what it has done.
 *
 * The progress panel used to show one line — whichever stage happened to be
 * current — plus a scrolling log. That tells you the engine is alive and
 * nothing else: not which steps exist, not how many are left, not whether the
 * slow one has been passed. A file that spends twelve seconds in "Cleaning
 * rows" looks identical to one that is stuck.
 *
 * So the worker announces its plan before it starts, and each stage it emits is
 * claimed by exactly one step here. The panel needs no knowledge of the
 * pipeline; it renders whatever plan it was handed.
 *
 * `stages` are matched exactly and `prefixes` by their start — the query step
 * emits "Querying: <chart title>", which is the one stage whose text is not
 * known ahead of time.
 *
 * The step lists and the strings the engine emits are the same literals, in the
 * same file, and `tests/progressSteps.test.mjs` reads the worker and the
 * pipeline to assert that every stage either belongs to a step or is
 * deliberately excused. A stage renamed on one side and not the other fails the
 * suite rather than quietly leaving the panel stuck on step two.
 */

/** Spreadsheets and pasted text: one or more files in, one joined view out. */
export const INGEST_FILES = [
  {
    id: 'read',
    label: 'Read the file',
    stages: ['Reading data', 'Reading file', 'Reading workbook'],
  },
  {
    id: 'clean',
    label: 'Clean and redact',
    // A workbook reports per sheet rather than per row batch.
    stages: ['Cleaning rows', 'Cleaning sheets'],
  },
  { id: 'profile', label: 'Profile the columns', stages: ['Profiling columns'] },
  { id: 'relate', label: 'Find relationships', stages: ['Relating sheets'] },
  { id: 'join', label: 'Build the analysis view', stages: ['Joining sheets'] },
  { id: 'ready', label: 'Ready', stages: ['Ready'] },
];

/**
 * A connected database: the rows arrive already parsed, so there is nothing to
 * read or delimit — the plan starts at cleaning, and the panel should not show
 * a "Read the file" step that will never run.
 */
export const INGEST_REMOTE = [
  { id: 'clean', label: 'Clean and redact', stages: ['Cleaning rows'] },
  { id: 'relate', label: 'Find relationships', stages: ['Relating tables'] },
  { id: 'join', label: 'Build the analysis view', stages: ['Joining tables'] },
  { id: 'ready', label: 'Ready', stages: ['Ready'] },
];

/** Planning, running and checking the charts. */
export const ANALYZE = [
  { id: 'plan', label: 'Plan the charts', stages: ['Planning charts'] },
  {
    id: 'query',
    label: 'Run the queries',
    stages: ['Running queries'],
    prefixes: ['Querying: '],
  },
  { id: 'verify', label: 'Verify the maths', stages: ['Verifying the maths'] },
  { id: 'ready', label: 'Ready', stages: ['Ready'] },
];

/**
 * Which step a stage belongs to, or -1.
 *
 * -1 is a real answer, not a failure: `Sanitizing & redacting` comes from the
 * cleaner on its own progress channel and never reaches a plan. The panel
 * treats an unclaimed stage as "keep the step you were on", which is why an
 * unrecognised stage degrades to the old behaviour instead of resetting the
 * checklist to the beginning.
 */
export function stepIndexFor(steps, stage) {
  if (!Array.isArray(steps) || !stage) return -1;
  return steps.findIndex(
    (s) =>
      s.stages?.includes(stage) ||
      s.prefixes?.some((p) => stage.startsWith(p))
  );
}
