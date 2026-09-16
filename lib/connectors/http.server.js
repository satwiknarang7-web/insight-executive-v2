import 'server-only';

/**
 * One HTTP call, the way every REST-backed connector should make it.
 *
 * The SQL drivers get their protection from the driver libraries and the host
 * guard. A connector that speaks HTTP gets nothing for free: the URL a user
 * typed is fetched by this server, which is the shape of a server-side request
 * forgery, and a slow endpoint would hold the route for as long as it liked.
 * So every call here resolves the host through the same `assertSafeHost` the
 * database drivers use, carries a timeout, and scrubs its errors before they
 * are shown.
 */
import { assertSafeHost, QUERY_TIMEOUT_MS, safeErrorMessage } from './guards.js';

/** Read the origin out of whatever a person pasted: a host, a host:port, a URL. */
export function originOf(value, { defaultScheme = 'https', defaultPort = null } = {}) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) throw new Error('A host is required.');
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `${defaultScheme}://${raw}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`"${raw}" is not a host this understands.`);
  }
  if (!url.port && defaultPort) url.port = String(defaultPort);
  return { origin: url.origin, hostname: url.hostname, pathname: url.pathname.replace(/\/+$/, '') };
}

/**
 * Fetch JSON (or text) with a timeout and a host check.
 *
 * @returns {Promise<{status:number, json:any, text:string, headers:Headers}>}
 */
export async function httpRequest(url, { method = 'GET', headers = {}, body, timeoutMs = QUERY_TIMEOUT_MS, expectJson = true } = {}) {
  const target = new URL(url);
  await assertSafeHost(target.hostname);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(target, {
      method,
      headers: {
        accept: expectJson ? 'application/json' : '*/*',
        ...(body !== undefined && typeof body !== 'string' ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      signal: controller.signal,
      redirect: 'manual',
    });
  } catch (error) {
    const reason = error?.name === 'AbortError' ? 'The request timed out.' : safeErrorMessage(error);
    throw new Error(reason);
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let json = null;
  if (expectJson || /application\/json/i.test(response.headers.get('content-type') || '')) {
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
  }
  if (!response.ok) {
    const detail =
      json?.message || json?.error?.message || json?.error || json?.exception || text.slice(0, 200) || response.statusText;
    throw new Error(`${response.status}: ${String(detail).replace(/\s+/g, ' ').slice(0, 240)}`);
  }
  return { status: response.status, json, text, headers: response.headers };
}

/** A Basic Authorization header, or none when there is no user. */
export function basicAuth(user, password) {
  if (!user) return {};
  return { authorization: `Basic ${Buffer.from(`${user}:${password || ''}`).toString('base64')}` };
}

/** Rows from a column list and an array of arrays, as every SQL driver returns them. */
export function rowsFromArrays(columns, arrays, cap) {
  const truncated = arrays.length > cap;
  const kept = truncated ? arrays.slice(0, cap) : arrays;
  const rows = kept.map((values) => {
    const row = {};
    for (let i = 0; i < columns.length; i++) row[columns[i]] = values[i];
    return row;
  });
  return { rows, columns, truncated, cap };
}
