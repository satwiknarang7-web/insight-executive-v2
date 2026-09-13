/**
 * Guided tour step definitions.
 *
 * Each step targets a DOM element by its `data-tutorial` attribute value. When
 * the tour reaches a step whose `page` differs from the current pathname, the
 * overlay navigates there first and waits for the target to appear.
 *
 * `placement` is a hint for the tooltip — the overlay repositions automatically
 * if the preferred side would clip the viewport.
 */
export const TUTORIAL_STEPS = [
  {
    target: 'upload-dropzone',
    page: '/',
    title: 'Upload your data',
    body: 'Drag and drop a CSV or Excel file here to get started. Your data never leaves your browser.',
    placement: 'left',
  },
  {
    target: 'sample-datasets',
    page: '/',
    title: 'Try a sample dataset',
    body: 'No data handy? Pick one of these pre-loaded samples to see the full analysis experience instantly.',
    placement: 'left',
  },
  {
    target: 'gemini-key-panel',
    page: '/',
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

/** localStorage key: set to '1' once the tour has been completed or skipped. */
export const TOUR_COMPLETED_KEY = 'insight.tour.completed';
