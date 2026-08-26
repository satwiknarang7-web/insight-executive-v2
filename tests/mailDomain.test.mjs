import test from 'node:test';
import assert from 'node:assert/strict';
import { forgetMailDomains, mailRoute } from '../lib/auth/mailDomain.js';

const dnsError = (code) => Object.assign(new Error(code), { code });

/** A fake resolver, so the rules can be tested without a network. */
function resolver({ mx = null, mxError = null, address = true, lookupError = null } = {}) {
  return {
    resolveMx: async () => {
      if (mxError) throw mxError;
      return mx ?? [];
    },
    lookup: async () => {
      if (lookupError) throw lookupError;
      if (!address) throw dnsError('ENOTFOUND');
      return [{ address: '203.0.113.1', family: 4 }];
    },
  };
}

test.beforeEach(() => forgetMailDomains());

test('a domain with an MX record accepts mail', async () => {
  const route = await mailRoute('example.com', resolver({ mx: [{ exchange: 'mail.example.com', priority: 10 }] }));
  assert.deepEqual(route, { deliverable: true, reason: 'mx' });
});

test('a domain with no MX but an address record still accepts mail', async () => {
  // RFC 5321: no MX means fall back to the address record. Plenty of small
  // self-hosted domains are set up exactly this way, and rejecting them would
  // be wrong.
  const route = await mailRoute('example.com', resolver({ mxError: dnsError('ENODATA') }));
  assert.equal(route.deliverable, true);
  assert.equal(route.reason, 'implicit mx');
});

test('a domain that does not exist is refused', async () => {
  const route = await mailRoute('gmial.com', resolver({ mxError: dnsError('ENOTFOUND') }));
  assert.equal(route.deliverable, false);
  assert.match(route.reason, /no such domain/);
});

test('a domain that exists but has no mail route at all is refused', async () => {
  const route = await mailRoute('example.com', resolver({ mxError: dnsError('ENODATA'), address: false }));
  assert.equal(route.deliverable, false);
  assert.match(route.reason, /no mail route/);
});

// ---------------------------------------------------------------------------
// Failing open — the rule that matters most
// ---------------------------------------------------------------------------

test('a resolver timeout does not block the sign-up', async () => {
  const never = { resolveMx: () => new Promise(() => {}), lookup: () => new Promise(() => {}) };
  const route = await mailRoute('example.com', { ...never, timeoutMs: 20 });
  assert.equal(route.deliverable, true, 'our own slowness is not evidence against the address');
  assert.match(route.reason, /lookup failed/);
});

test('a resolver that errors for any other reason does not block the sign-up', async () => {
  const route = await mailRoute('example.com', resolver({ mxError: dnsError('ESERVFAIL') }));
  assert.equal(route.deliverable, true);
  assert.match(route.reason, /lookup failed/);
});

test('no resolver at all does not block the sign-up', async () => {
  const route = await mailRoute('example.com', {});
  assert.deepEqual(route, { deliverable: true, reason: 'no resolver' });
});

test('an empty domain is refused without asking anyone', async () => {
  let asked = false;
  const route = await mailRoute('', {
    resolveMx: async () => {
      asked = true;
      return [];
    },
    lookup: async () => [],
  });
  assert.equal(route.deliverable, false);
  assert.equal(asked, false);
});

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

test('a repeated domain is looked up once', async () => {
  let calls = 0;
  const counting = {
    resolveMx: async () => {
      calls++;
      return [{ exchange: 'mail.example.com', priority: 10 }];
    },
    lookup: async () => [],
  };

  await mailRoute('example.com', counting);
  await mailRoute('EXAMPLE.COM', counting);
  await mailRoute('  example.com  ', counting);
  assert.equal(calls, 1, 'the domain is normalised before it is cached');
});

test('a cached answer expires', async () => {
  let calls = 0;
  const counting = {
    resolveMx: async () => {
      calls++;
      return [{ exchange: 'mail.example.com', priority: 10 }];
    },
    lookup: async () => [],
  };

  const start = Date.now();
  await mailRoute('example.com', { ...counting, now: start });
  await mailRoute('example.com', { ...counting, now: start + 60 * 60 * 1000 });
  assert.equal(calls, 2);
});

test('a failure we caused is not cached', async () => {
  let calls = 0;
  const flaky = {
    resolveMx: async () => {
      calls++;
      if (calls === 1) throw dnsError('ESERVFAIL');
      return [{ exchange: 'mail.example.com', priority: 10 }];
    },
    lookup: async () => [],
  };

  const first = await mailRoute('example.com', flaky);
  assert.match(first.reason, /lookup failed/);
  const second = await mailRoute('example.com', flaky);
  assert.equal(second.reason, 'mx', 'a transient failure must not stick to the domain for ten minutes');
});
