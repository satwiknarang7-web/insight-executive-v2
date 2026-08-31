import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FABRIC_SCOPE,
  configForItem,
  flattenCatalog,
  hasTarget,
  parseLakehouses,
  parseToken,
  parseWarehouses,
  parseWorkspaces,
  tokenBody,
  tokenUrl,
} from '../lib/connectors/fabricApi.js';

test('the token request is aimed at the tenant and the Fabric audience', () => {
  assert.equal(
    tokenUrl('contoso.onmicrosoft.com'),
    'https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/token'
  );

  const body = tokenBody({ clientId: 'app-id', clientSecret: 's3cret' });
  assert.equal(body.get('grant_type'), 'client_credentials');
  assert.equal(body.get('client_id'), 'app-id');
  assert.equal(body.get('client_secret'), 's3cret');
  assert.equal(body.get('scope'), FABRIC_SCOPE);
});

test('a tenant id with unsafe characters cannot escape the path', () => {
  assert.ok(!tokenUrl('../../evil').includes('../..'));
});

test('the token comes back, or the reason it did not', () => {
  assert.deepEqual(parseToken({ access_token: 'abc' }), { token: 'abc', error: null });

  const refused = parseToken({
    error: 'invalid_client',
    error_description: 'AADSTS7000215: Invalid client secret provided.\r\nTrace ID: abc\r\nTimestamp: now',
  });
  assert.equal(refused.token, null);
  // The first line is the part that tells you what to fix; the trace id is not.
  assert.equal(refused.error, 'AADSTS7000215: Invalid client secret provided.');
});

test('an empty reply still produces a reason rather than a crash', () => {
  assert.equal(parseToken({}).token, null);
  assert.equal(parseToken(null).token, null);
  assert.match(parseToken(undefined).error, /no access token/);
});

test('workspaces are read off the reply', () => {
  const parsed = parseWorkspaces({
    value: [
      { id: 'w1', displayName: 'Finance' },
      { id: 'w2' },
      { displayName: 'no id, dropped' },
    ],
  });
  assert.deepEqual(parsed, [
    { id: 'w1', name: 'Finance' },
    { id: 'w2', name: 'w2' },
  ]);
});

test('a warehouse carries its own SQL endpoint', () => {
  const [item] = parseWarehouses(
    {
      value: [
        {
          id: 'wh1',
          displayName: 'Sales WH',
          properties: { connectionString: 'abc123.datawarehouse.fabric.microsoft.com' },
        },
      ],
    },
    { id: 'w1', name: 'Finance' }
  );

  assert.equal(item.kind, 'warehouse');
  assert.equal(item.endpoint, 'abc123.datawarehouse.fabric.microsoft.com');
  assert.equal(item.database, 'Sales WH');
  assert.equal(item.workspaceName, 'Finance');
});

test("a lakehouse's endpoint is nested a level deeper", () => {
  const [item] = parseLakehouses(
    {
      value: [
        {
          id: 'lh1',
          displayName: 'Bronze',
          properties: {
            sqlEndpointProperties: { connectionString: 'xyz.datawarehouse.fabric.microsoft.com', id: 'ep1' },
          },
        },
      ],
    },
    { id: 'w1', name: 'Finance' }
  );

  assert.equal(item.kind, 'lakehouse');
  assert.equal(item.endpoint, 'xyz.datawarehouse.fabric.microsoft.com');
  assert.equal(item.database, 'Bronze');
});

test('an item with no endpoint yet is not offered', () => {
  // A lakehouse whose SQL endpoint is still provisioning. Offering it would
  // produce a connection that cannot be dialled.
  const items = parseLakehouses(
    { value: [{ id: 'lh2', displayName: 'Provisioning', properties: {} }] },
    { id: 'w1', name: 'Finance' }
  );
  assert.equal(items.length, 0);

  assert.equal(parseWarehouses({ value: [{ id: 'wh2', displayName: 'No endpoint' }] }, {}).length, 0);
});

test('the catalog is flattened into a stable order', () => {
  const groups = [
    {
      items: [
        { id: '2', kind: 'warehouse', name: 'Zeta', workspaceName: 'Ops' },
        { id: '1', kind: 'lakehouse', name: 'Alpha', workspaceName: 'Ops' },
      ],
    },
    { items: [{ id: '3', kind: 'warehouse', name: 'Beta', workspaceName: 'Finance' }] },
  ];

  const flat = flattenCatalog(groups);
  assert.deepEqual(
    flat.map((i) => `${i.workspaceName}/${i.kind}/${i.name}`),
    ['Finance/warehouse/Beta', 'Ops/lakehouse/Alpha', 'Ops/warehouse/Zeta']
  );

  // The API's own order is not stable, so the same tenant must always come back
  // the same way round — a select whose options move is one people mis-click.
  assert.deepEqual(flattenCatalog(groups), flat);
});

test('choosing an item produces exactly the config the driver needs', () => {
  const config = configForItem({
    id: 'wh1',
    kind: 'warehouse',
    name: 'Sales WH',
    endpoint: 'abc.datawarehouse.fabric.microsoft.com',
    database: 'Sales WH',
    workspaceId: 'w1',
    workspaceName: 'Finance',
  });

  assert.equal(config.endpoint, 'abc.datawarehouse.fabric.microsoft.com');
  assert.equal(config.database, 'Sales WH');
  assert.equal(config.itemKind, 'warehouse');
  // Nothing secret rides along: this is written to a table the browser reads.
  assert.deepEqual(Object.keys(config).sort(), [
    'database',
    'endpoint',
    'itemId',
    'itemKind',
    'itemName',
    'workspaceId',
    'workspaceName',
  ]);
});

test('an incomplete item cannot be selected', () => {
  assert.equal(configForItem({ id: 'x', endpoint: 'host' }), null);
  assert.equal(configForItem(null), null);
});

test('a connection knows whether it has been pointed at anything', () => {
  assert.equal(hasTarget({ endpoint: 'h', database: 'd' }), true);
  assert.equal(hasTarget({ tenantId: 't', clientId: 'c' }), false);
  assert.equal(hasTarget({ endpoint: 'h' }), false);
  assert.equal(hasTarget(null), false);
});
