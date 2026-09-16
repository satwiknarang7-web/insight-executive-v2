/**
 * Data that lives at a URL.
 *
 * A Google Sheet, a CSV on GitHub, a JSON API, an OData feed, a public object
 * in S3 — all of them are a file behind an address, and the only thing that
 * differs is the address people paste. A sheet is pasted as its editing URL;
 * a GitHub file as the page that shows it; a Dropbox file as a share link
 * that renders a preview. None of those return the bytes. So the first job is
 * to turn the link a person has into the link that serves the data, and that
 * is a pure rewrite worth testing on its own.
 *
 * What comes back is still read by the same parsers a dropped file goes
 * through; the URL only decides where the bytes come from.
 */

/** The kinds of web source the catalog offers, and what to say about each. */
export const WEB_SOURCES = [
  {
    id: 'url',
    label: 'Web file (CSV, JSON, Excel…)',
    blurb: 'Any file behind a link: a CSV on GitHub or S3, a JSON export, a spreadsheet on a public share.',
    placeholder: 'https://example.com/data/orders.csv',
    auth: 'optional',
  },
  {
    id: 'googlesheets',
    label: 'Google Sheets',
    blurb: 'Paste the sheet’s link. It has to be shared as “anyone with the link can view”; the first tab is read unless the link names another.',
    placeholder: 'https://docs.google.com/spreadsheets/d/…/edit#gid=0',
    auth: 'none',
  },
  {
    id: 'restapi',
    label: 'REST API (JSON)',
    blurb: 'A GET endpoint that returns JSON. The largest array of records in the reply becomes the table. A bearer token or API key can be sent with it.',
    placeholder: 'https://api.example.com/v1/orders?limit=1000',
    auth: 'optional',
  },
  {
    id: 'odata',
    label: 'OData feed',
    blurb: 'An OData v2–v4 entity set. Rows are read from the feed’s value array, following @odata.nextLink up to the row cap.',
    placeholder: 'https://services.odata.org/V4/Northwind/Northwind.svc/Orders',
    auth: 'optional',
  },
  {
    id: 'webpage',
    label: 'Web page (HTML tables)',
    blurb: 'Every table on the page, read as a table. Wikipedia, a league table, a price list.',
    placeholder: 'https://en.wikipedia.org/wiki/List_of_countries_by_population',
    auth: 'none',
  },
];

export function webSource(id) {
  return WEB_SOURCES.find((s) => s.id === id) || null;
}

/**
 * The address that serves the bytes, for the address a person pasted.
 *
 * Returns `{ url, name, hint }`: the fetchable URL, a file name to give the
 * result (which is what tells the parser what it is), and a note when the
 * rewrite is worth mentioning.
 */
export function normalizeSourceUrl(input, { kind = 'url' } = {}) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Paste a link first.');
  let url;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error(`"${raw}" is not a link this understands.`);
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error('Only http and https links can be read.');

  const host = url.hostname.toLowerCase();

  // Google Sheets: the editing page → the CSV export of one tab.
  const sheet = url.pathname.match(/^\/spreadsheets\/d\/(?:e\/)?([^/]+)/);
  if (host === 'docs.google.com' && sheet) {
    const gid = (url.hash.match(/gid=(\d+)/) || url.searchParams.get('gid')?.match(/(\d+)/) || [])[1];
    const published = url.pathname.startsWith('/spreadsheets/d/e/');
    const out = published
      ? `https://docs.google.com/spreadsheets/d/e/${sheet[1]}/pub?output=csv${gid ? `&gid=${gid}` : ''}`
      : `https://docs.google.com/spreadsheets/d/${sheet[1]}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
    return { url: out, name: 'google-sheet.csv', hint: gid ? `Reading tab ${gid} as CSV.` : 'Reading the first tab as CSV.' };
  }

  // GitHub: the page that shows a file → the raw file.
  const blob = url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
  if (host === 'github.com' && blob) {
    return { url: `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}`, name: nameFromPath(blob[3]), hint: 'Reading the raw file from GitHub.' };
  }
  // A gist page → its raw form.
  if (host === 'gist.github.com' && !/\/raw\b/.test(url.pathname)) {
    return { url: `${url.origin}${url.pathname.replace(/\/$/, '')}/raw`, name: nameFromPath(url.pathname) || 'gist.txt', hint: 'Reading the raw gist.' };
  }

  // Dropbox share links render a preview unless asked for the file.
  if (/(^|\.)dropbox\.com$/.test(host)) {
    url.searchParams.set('dl', '1');
    return { url: url.toString(), name: nameFromPath(url.pathname), hint: 'Reading the file rather than the preview page.' };
  }

  // OneDrive / SharePoint "view" links can be asked for a download.
  if (/(^|\.)(1drv\.ms|onedrive\.live\.com|sharepoint\.com)$/.test(host)) {
    if (!url.searchParams.has('download')) url.searchParams.set('download', '1');
    return { url: url.toString(), name: nameFromPath(url.pathname) || 'onedrive-file', hint: 'Asking OneDrive for the file itself.' };
  }

  // An OData feed answers XML unless asked for JSON.
  if (kind === 'odata') {
    if (!url.searchParams.has('$format')) url.searchParams.set('$format', 'json');
    return { url: url.toString(), name: `${nameFromPath(url.pathname) || 'odata'}.json`, hint: null };
  }

  if (kind === 'restapi') return { url: url.toString(), name: `${nameFromPath(url.pathname) || 'api'}.json`, hint: null };
  if (kind === 'webpage') return { url: url.toString(), name: `${nameFromPath(url.pathname) || 'page'}.html`, hint: null };

  return { url: url.toString(), name: nameFromPath(url.pathname) || 'download', hint: null };
}

/** The last path segment, decoded, without a trailing slash. */
export function nameFromPath(pathname) {
  const last = String(pathname || '')
    .split('/')
    .filter(Boolean)
    .pop();
  if (!last) return '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** A file name with an extension the parsers recognise, from a name and a content type. */
export function fileNameFor(name, contentType = '') {
  const base = String(name || 'download').replace(/[?#].*$/, '');
  if (/\.[a-z0-9]{2,7}$/i.test(base)) return base;
  const type = String(contentType || '').toLowerCase();
  if (/json/.test(type)) return `${base}.json`;
  // Before the XML check: a workbook's type is "spreadsheetml", which has xml in it.
  if (/spreadsheetml|ms-excel/.test(type)) return `${base}.xlsx`;
  if (/xml/.test(type)) return `${base}.xml`;
  if (/html/.test(type)) return `${base}.html`;
  if (/parquet/.test(type)) return `${base}.parquet`;
  if (/tab-separated/.test(type)) return `${base}.tsv`;
  return `${base}.csv`;
}

/** The headers a source's auth choice sends, from what the person typed. */
export function authHeaders({ scheme = 'none', token = '', headerName = 'X-API-Key' } = {}) {
  const value = String(token || '').trim();
  if (!value || scheme === 'none') return {};
  if (scheme === 'bearer') return { authorization: `Bearer ${value}` };
  if (scheme === 'basic') {
    // Typed as user:password; sent encoded, as the header requires.
    const encoded = typeof btoa === 'function' ? btoa(value) : Buffer.from(value).toString('base64');
    return { authorization: `Basic ${encoded}` };
  }
  if (scheme === 'header') return { [String(headerName || 'X-API-Key').trim()]: value };
  return {};
}
