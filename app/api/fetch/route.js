import { NextResponse } from 'next/server';
import { assertSafeHost, BlockedHost } from '../../../lib/connectors/guards';
import { enforceLimit } from '../../../lib/routeLimits.server';
import { fileNameFor, normalizeSourceUrl } from '../../../lib/webSources';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Fetch a file from the web on the browser's behalf.
 *
 * A browser cannot read a CSV off another origin unless that origin says so,
 * and almost none do. So the bytes come through here: the server fetches
 * them and hands them back, and the browser parses them exactly as it would a
 * dropped file. Nothing is kept.
 *
 * That makes this a server-side request forgery in waiting, and the guards
 * are the same ones the database connectors use: the host is resolved and
 * refused if it is private, redirects are followed by hand so a public URL
 * cannot bounce to an internal one, the body is capped, and the request is
 * timed out. An OData feed is followed through its `@odata.nextLink` pages
 * here as well, since the browser has no way to make those calls itself.
 */

const MAX_BYTES = 40 * 1024 * 1024;
const MAX_HOPS = 5;
const TIMEOUT_MS = 30000;
const MAX_ODATA_PAGES = 50;

async function fetchGuarded(url, headers, { expectJson = false } = {}) {
  let current = new URL(url);
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    await assertSafeHost(current.hostname);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;
    try {
      response = await fetch(current, {
        headers: { 'user-agent': 'insight-analytics/1.0 (+data import)', accept: expectJson ? 'application/json, */*' : '*/*', ...headers },
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (error) {
      throw new Error(error?.name === 'AbortError' ? 'The site did not answer in time.' : 'The site could not be reached.');
    } finally {
      clearTimeout(timer);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('The site redirected to nowhere.');
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) throw new Error(`The site answered ${response.status} ${response.statusText || ''}`.trim());
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > MAX_BYTES) throw new Error(`That file is ${Math.round(declared / 1048576)} MB; the limit is ${MAX_BYTES / 1048576} MB.`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_BYTES) throw new Error(`That file is over ${MAX_BYTES / 1048576} MB.`);
    return { buffer, contentType: response.headers.get('content-type') || '', finalUrl: current.toString() };
  }
  throw new Error('Too many redirects.');
}

/** Follow an OData feed's pages, concatenating `value` up to the cap. */
async function fetchOData(url, headers) {
  const rows = [];
  let next = url;
  for (let page = 0; next && page < MAX_ODATA_PAGES && rows.length < 50000; page++) {
    const { buffer } = await fetchGuarded(next, headers, { expectJson: true });
    let body;
    try {
      body = JSON.parse(buffer.toString('utf8'));
    } catch {
      throw new Error('The feed did not answer with JSON. Add $format=json, or check the address.');
    }
    const value = Array.isArray(body?.value) ? body.value : Array.isArray(body?.d?.results) ? body.d.results : Array.isArray(body?.d) ? body.d : null;
    if (!value) throw new Error('The feed has no value array — is this an entity set?');
    rows.push(...value);
    // A next link may be relative to the service root; resolve it against the
    // page it came from, or the proxy would try to fetch "Orders?$skiptoken=".
    const link = body['@odata.nextLink'] || body['odata.nextLink'] || body?.d?.__next || null;
    next = link ? new URL(link, next).toString() : null;
  }
  return { buffer: Buffer.from(JSON.stringify(rows)), contentType: 'application/json', truncated: !!next };
}

export async function POST(request) {
  const refused = await enforceLimit(request, 'fetch');
  if (refused) return refused;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }
  const { url, kind = 'url', headers = {} } = body || {};
  const extra = {};
  for (const [k, v] of Object.entries(headers || {})) {
    // Only headers a person would type to authenticate. Nothing that changes
    // what the server is or where the request goes.
    if (/^(authorization|x-[a-z0-9-]+|api-?key|apikey)$/i.test(k) && typeof v === 'string' && v.length < 4096) extra[k] = v;
  }

  try {
    const target = normalizeSourceUrl(url, { kind });
    const fetched = kind === 'odata' ? await fetchOData(target.url, extra) : await fetchGuarded(target.url, extra, { expectJson: kind === 'restapi' });
    const name = fileNameFor(target.name, fetched.contentType);

    return new NextResponse(fetched.buffer, {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'x-insight-file-name': encodeURIComponent(name),
        'x-insight-hint': encodeURIComponent(target.hint || ''),
        'x-insight-truncated': fetched.truncated ? '1' : '0',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    const status = error instanceof BlockedHost ? 400 : 502;
    return NextResponse.json({ error: error.message || 'That link could not be read.' }, { status });
  }
}
