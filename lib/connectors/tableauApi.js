/**
 * Tableau REST and VizQL Data Service helpers.
 *
 * Tableau is the one source here that is not a database. There is no SQL, no
 * schema and no table — there are *published data sources*, addressed by an
 * opaque LUID, queried by naming the fields you want. So the shape of this file
 * is URL building and response reshaping rather than connection handling.
 *
 * Kept free of `server-only` so the parsing can be tested without a server.
 */

/** REST API version. 3.19 is widely available and carries everything used here. */
export const REST_VERSION = '3.19';

/**
 * Validate and normalise a Tableau server URL.
 *
 * Returned separately as an origin and a host so the caller can run the host
 * through the SSRF check before any request is made.
 */
export function parseServerUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error('A Tableau server URL is required.');

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error('That is not a valid Tableau server URL.');
  }

  // Tableau Cloud and any sane Server deployment are HTTPS. Allowing plain HTTP
  // would send a personal access token across the network in the clear.
  if (url.protocol !== 'https:') {
    throw new Error('Tableau must be reached over HTTPS.');
  }

  return { origin: url.origin, host: url.hostname };
}

/** The sign-in payload. A blank site content URL means the Default site. */
export function signInBody({ patName, patSecret, site }) {
  if (!patName || !patSecret) {
    throw new Error('A personal access token name and secret are both required.');
  }
  return {
    credentials: {
      personalAccessTokenName: patName,
      personalAccessTokenSecret: patSecret,
      site: { contentUrl: String(site || '').trim() },
    },
  };
}

/** Pull the session token and site id out of a sign-in response. */
export function parseSignIn(payload) {
  const credentials = payload?.credentials;
  const token = credentials?.token;
  const siteId = credentials?.site?.id;
  if (!token || !siteId) {
    throw new Error('Tableau accepted the request but returned no session. Check the token and site.');
  }
  return { token, siteId };
}

/** Published data sources, reshaped into the table descriptors the UI expects. */
export function parseDataSources(payload) {
  const list = payload?.datasources?.datasource;
  const items = Array.isArray(list) ? list : list ? [list] : [];

  return items.map((d) => ({
    // `ref` is the opaque handle a non-SQL source needs: Tableau addresses a
    // data source by LUID, not by a schema-and-table pair.
    ref: d.id,
    schema: d.project?.name || 'Published',
    name: d.name,
    qualified: `${d.project?.name || 'Published'}.${d.name}`,
    isView: false,
  }));
}

/**
 * Turn VDS metadata into the field list a query needs.
 *
 * A VDS query must name its fields — there is no `SELECT *`. Asking for every
 * field is the closest equivalent, and is what "import this data source" means.
 */
export function fieldsFromMetadata(payload) {
  const list = payload?.data;
  const items = Array.isArray(list) ? list : [];
  return items
    .map((f) => ({
      name: f.fieldName ?? f.fieldCaption,
      caption: f.fieldCaption ?? f.fieldName,
      dataType: f.dataType,
      logicalTableId: f.logicalTableId,
    }))
    .filter((f) => f.caption);
}

/** Build the query body for a set of fields. */
export function queryBody(datasourceLuid, fields) {
  if (!datasourceLuid) throw new Error('A data source is required.');
  if (!fields?.length) throw new Error('That data source exposes no fields to query.');

  return {
    datasource: { datasourceLuid },
    query: {
      // VDS identifies a field by its caption, and returns it under that name.
      fields: fields.map((f) => ({ fieldCaption: f.caption })),
    },
  };
}

/**
 * Reshape a VDS response into rows and columns.
 *
 * VDS returns `data` as an array of objects keyed by field caption, which is
 * already close to what the analysis engine wants — but the column order has to
 * come from the requested fields, since object key order is not a contract.
 */
export function rowsFromQuery(payload, fields) {
  const data = Array.isArray(payload?.data) ? payload.data : [];
  const columns = fields.map((f) => f.caption);
  return { rows: data, columns };
}

/**
 * Which returned fields Tableau declared as numeric.
 *
 * VDS reports `INTEGER` / `REAL` for measures. Passing these to the shared
 * normaliser is what stops a measure arriving as a string and being profiled as
 * a category.
 */
export function numericFields(fields) {
  const numeric = new Set();
  for (const f of fields) {
    if (/^(integer|real|number|float|decimal)$/i.test(String(f.dataType || ''))) {
      numeric.add(f.caption);
    }
  }
  return numeric;
}
