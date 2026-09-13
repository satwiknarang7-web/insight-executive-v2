/**
 * Guided tour step definitions.
 *
 * Each step targets a DOM element by its `data-tutorial` attribute value and
 * belongs to exactly one page. The tour never navigates on the reader's behalf.
 * It shows the steps for the page they are already on, and picks up again when
 * they arrive somewhere it has more to say.
 *
 * That is not only a matter of manners. Every page below the landing screen
 * needs a dataset, and `AppShell` sends anyone without one back to `/` — so a
 * tour that pushed its own way to `/dashboard` would be bounced straight back,
 * re-fire on the pathname change, and push again. The tour cannot drive.
 *
 * `placement` is a hint for the tooltip — the overlay flips to the opposite
 * side if the preferred one would clip the viewport.
 */
export const TUTORIAL_STEPS = [
  {
    target: 'upload-dropzone',
    page: '/home',
    title: 'Upload your data',
    body: 'Drag and drop a CSV or Excel file here to get started. Your data never leaves your browser.',
    placement: 'left',
  },
  {
    target: 'sample-datasets',
    page: '/home',
    title: 'Try a sample dataset',
    body: 'No data handy? Pick one of these pre-loaded samples to see the full analysis experience instantly.',
    placement: 'left',
  },
  {
    target: 'gemini-key-panel',
    page: '/home',
    title: 'Optional: connect an AI key',
    body: 'Add a Gemini API key to unlock AI-written executive summaries and narratives. Everything else works without one.',
    placement: 'left',
  },
  {
    target: 'dashboard-kpis',
    page: '/dashboard',
    title: 'Key performance indicators',
    body: 'Your top-level KPIs are computed from the data and displayed here. Every number traces back to a real SQL query.',
    placement: 'bottom',
  },
  {
    target: 'dashboard-summary',
    page: '/dashboard',
    title: 'Executive summary',
    body: 'A concise overview of the most important findings. If you connected an AI key, this is phrased by the model — the statistics behind it are always deterministic.',
    placement: 'bottom',
  },
  {
    target: 'dashboard-findings',
    page: '/dashboard',
    title: 'Auto-generated findings',
    body: 'Each card is a chart chosen by the data, with the query that produced it. Click any card to dive deeper, edit it, or change the chart type.',
    placement: 'top',
  },
  {
    target: 'explore-table',
    page: '/explore',
    title: 'Browse your data',
    body: 'The cleaned, type-coerced rows are browsable here. Search, sort, and filter to inspect what the analysis is working with.',
    placement: 'top',
  },
  {
    target: 'ask-input',
    page: '/ask',
    title: 'Ask anything',
    body: 'Type a plain-English question and get a chart with the SQL beside it. The query runs in your browser over the same cleaned rows.',
    placement: 'bottom',
  },
];

/** The pages the tour has something to say about, in the order it expects them. */
export const TOUR_PAGES = [...new Set(TUTORIAL_STEPS.map((step) => step.page))];

/**
 * What the tour says when a page's steps run out.
 *
 * This is the hand-back: the reader does the thing that moves them on, and the
 * tour waits. A page with no entry here is the end of the tour.
 */
export const PAGE_ADVANCE = {
  '/home': 'Upload a file or pick a sample above — the tour picks up again on the dashboard.',
  '/dashboard': 'Open Explore in the sidebar whenever you want to carry on.',
  '/explore': 'Open Ask in the sidebar for the last part of the tour.',
};

/** localStorage key: set to '1' once the tour has been completed or dismissed. */
export const TOUR_COMPLETED_KEY = 'insight.tour.completed';
