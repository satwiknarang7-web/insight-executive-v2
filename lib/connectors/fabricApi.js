/**
 * Talking to the Fabric REST API, as pure functions.
 *
 * Fabric is the one connector where the user cannot reasonably be asked for the
 * connection target up front. A SQL analytics endpoint is a 40-character
 * hostname buried three clicks into the portal, different for every warehouse
 * and lakehouse, and nobody has it to hand — asking for it made the form look
 * like it wanted a database administrator when the credentials alone are enough
 * to go and *find* every item the service principal can see.
 *
 * So the flow inverts: three fields identify the application, and the list of
 * things it can read is discovered afterwards. The endpoint for whichever item
 * is chosen comes back from the API, which is the only place it is authoritative
 * anyway.
 *
 * The HTTP lives in `fabric.server.js`. What is here is the shape of each
 * request and the shape of each reply — the parts worth testing without a
 * Microsoft tenant to point at, and the parts most likely to be wrong.
 */

/** Entra's client-credentials endpoint for one tenant. */
export function tokenUrl(tenantId) {
  return `https://login.microsoftonline.com/${encodeURIComponent(String(tenantId || '').trim())}/oauth2/v2.0/token`;
}

/** The audience a Fabric REST token is minted for. */
export const FABRIC_SCOPE = 'https://api.fabric.microsoft.com/.default';

export const FABRIC_API = 'https://api.fabric.microsoft.com/v1';

/**
 * The token request body.
 *
 * Form-encoded rather than JSON: the OAuth 2.0 token endpoint takes
 * `application/x-www-form-urlencoded` and answers JSON with an error if it is
 * given anything else.
 */
export function tokenBody({ clientId, clientSecret }) {
  const form = new URLSearchParams();
  form.set('grant_type', 'client_credentials');
  form.set('client_id', String(clientId || '').trim());
  form.set('client_secret', String(clientSecret || ''));
  form.set('scope', FABRIC_SCOPE);
  return form;
}

/**
 * Pull the access token out of Entra's reply.
 *
 * Its error shape carries `error_description`, which is the single most useful
 * string in this whole flow — it distinguishes a wrong secret from a tenant
 * that has never heard of the application from a service principal with no
 * Fabric licence. Returning it verbatim is deliberate: the caller is the person
 * who typed the credentials.
 */
export function parseToken(payload) {
  if (payload?.access_token) return { token: payload.access_token, error: null };
  const detail = payload?.error_description || payload?.error || 'no access token was returned';
  // Entra's descriptions are multi-line and end with a correlation id and a
  // timestamp, none of which helps here.
  return { token: null, error: String(detail).split('\n')[0].trim() };
}

export const workspacesUrl = () => `${FABRIC_API}/workspaces`;
export const warehousesUrl = (workspaceId) => `${FABRIC_API}/workspaces/${workspaceId}/warehouses`;
export const lakehousesUrl = (workspaceId) => `${FABRIC_API}/workspaces/${workspaceId}/lakehouses`;

/** The workspaces this service principal can see. */
export function parseWorkspaces(payload) {
  return (payload?.value || [])
    .filter((w) => w?.id)
    .map((w) => ({ id: w.id, name: w.displayName || w.id }));
}

/**
 * Normalise a warehouse into something the connection can be pointed at.
 *
 * `properties.connectionString` is the SQL analytics endpoint — the hostname
 * the TDS driver dials — and the item's display name is the database on it.
 */
export function parseWarehouses(payload, workspace) {
  return (payload?.value || [])
    .filter((item) => item?.id && item?.properties?.connectionString)
    .map((item) => ({
      id: item.id,
      kind: 'warehouse',
      name: item.displayName || item.id,
      workspaceId: workspace?.id || null,
      workspaceName: workspace?.name || null,
      endpoint: item.properties.connectionString,
      database: item.displayName || item.id,
    }));
}

/**
 * The same for a lakehouse, whose endpoint is nested one level deeper.
 *
 * A lakehouse without `sqlEndpointProperties` is one whose SQL endpoint is
 * still provisioning; it is dropped rather than offered, because selecting it
 * would produce a connection that cannot be dialled.
 */
export function parseLakehouses(payload, workspace) {
  return (payload?.value || [])
    .filter((item) => item?.id && item?.properties?.sqlEndpointProperties?.connectionString)
    .map((item) => ({
      id: item.id,
      kind: 'lakehouse',
      name: item.displayName || item.id,
      workspaceId: workspace?.id || null,
      workspaceName: workspace?.name || null,
      endpoint: item.properties.sqlEndpointProperties.connectionString,
      database: item.displayName || item.id,
    }));
}

/**
 * One flat, ordered list for the dropdown.
 *
 * Sorted by workspace then name so the same tenant always lists in the same
 * order — the API's own order is not stable, and a select whose options move
 * between openings is one people mis-click.
 */
export function flattenCatalog(groups) {
  return groups
    .flatMap((group) => group.items || [])
    .sort(
      (a, b) =>
        String(a.workspaceName || '').localeCompare(String(b.workspaceName || '')) ||
        String(a.kind).localeCompare(String(b.kind)) ||
        String(a.name).localeCompare(String(b.name))
    );
}

/** The config fields an item selection writes back onto the connection. */
export function configForItem(item) {
  if (!item?.endpoint || !item?.database) return null;
  return {
    endpoint: item.endpoint,
    database: item.database,
    itemId: item.id,
    itemKind: item.kind,
    itemName: item.name,
    workspaceId: item.workspaceId,
    workspaceName: item.workspaceName,
  };
}

/** Has an item been chosen for this connection yet? */
export function hasTarget(config) {
  return !!(config?.endpoint && config?.database);
}
