import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LIMITS, limitKey, refusalMessage } from '../lib/routeLimits.js';
import { take, clearAll } from '../lib/auth/rateLimit.js';

test('every bucket has a positive allowance and a real window', () => {
  const names = Object.keys(LIMITS);
  assert.ok(names.length > 0, 'there is at least one limited route');
  for (const [name, policy] of Object.entries(LIMITS)) {
    assert.ok(Number.isInteger(policy.limit) && policy.limit > 0, `${name} has a usable limit`);
    assert.ok(policy.windowMs > 0, `${name} has a usable window`);
  }
});

test('the slow, expensive routes are capped harder than the cheap ones', () => {
  // A PDF is a headless browser for up to a minute; a narration chunk is one
  // HTTP call. Costing them the same would either throttle presenting or leave
  // Chrome unguarded.
  assert.ok(LIMITS.pdf.limit < LIMITS.speech.limit);
  assert.ok(LIMITS.shareNotify.limit < LIMITS.speech.limit);
  assert.ok(LIMITS.narrate.limit < LIMITS.ask.limit);
});

test('a session is the key where there is one, and the address otherwise', () => {
  assert.equal(limitKey({ bucket: 'ask', userId: 'u-1', ip: '9.9.9.9' }), 'u:u-1:ask');
  assert.equal(limitKey({ bucket: 'ask', userId: null, ip: '9.9.9.9' }), 'ip:9.9.9.9:ask');
  assert.equal(limitKey({ bucket: 'ask', userId: null, ip: null }), 'ip:unknown:ask');
});

test('one caller cannot spend another caller\'s allowance', () => {
  // Different people, and the same person on different routes, are separate
  // buckets — otherwise narrating a deck would use up the budget for asking
  // questions.
  const keys = [
    limitKey({ bucket: 'ask', userId: 'u-1' }),
    limitKey({ bucket: 'ask', userId: 'u-2' }),
    limitKey({ bucket: 'narrate', userId: 'u-1' }),
    limitKey({ bucket: 'ask', ip: '1.1.1.1' }),
  ];
  assert.equal(new Set(keys).size, keys.length, 'every key is distinct');
});

test('signing out does not hand over a fresh allowance', () => {
  // The two namespaces are deliberately disjoint, so a caller cannot drop their
  // session mid-window and inherit the address bucket's unused count.
  assert.notEqual(
    limitKey({ bucket: 'ask', userId: 'u-1', ip: '1.1.1.1' }),
    limitKey({ bucket: 'ask', userId: null, ip: '1.1.1.1' })
  );
});

test('a refusal says when to come back, in units a person reads', () => {
  assert.match(refusalMessage(30), /30 seconds/);
  assert.match(refusalMessage(600), /10 minutes/);
  assert.match(refusalMessage(0), /1 seconds/); // never "0 seconds", never silent
});

test('the policy actually stops a runaway caller at its limit', () => {
  // The policy and the counter, together — the numbers are only meaningful if
  // the mechanism they are handed to enforces them.
  clearAll();
  const key = limitKey({ bucket: 'pdf', userId: 'u-loop' });
  const policy = LIMITS.pdf;

  let allowed = 0;
  for (let i = 0; i < policy.limit + 25; i++) {
    if (take(key, policy).allowed) allowed++;
  }
  assert.equal(allowed, policy.limit, 'exactly the allowance gets through');

  const refused = take(key, policy);
  assert.equal(refused.allowed, false);
  assert.ok(refused.retryAfterSeconds > 0, 'and it says when to retry');
  clearAll();
});

test('a different person is unaffected by someone else hitting the wall', () => {
  clearAll();
  const policy = LIMITS.pdf;
  const loud = limitKey({ bucket: 'pdf', userId: 'u-loud' });
  for (let i = 0; i < policy.limit + 5; i++) take(loud, policy);
  assert.equal(take(loud, policy).allowed, false, 'the loud caller is stopped');

  const quiet = limitKey({ bucket: 'pdf', userId: 'u-quiet' });
  assert.equal(take(quiet, policy).allowed, true, 'everyone else still works');
  clearAll();
});

// ---------------------------------------------------------------------------
// The routes are wired.
//
// A limit nothing calls is worse than no limit, because it reads as protection.
// The route files import next/server and a Supabase client, so they cannot be
// imported here; this checks the wiring where it is written.
// ---------------------------------------------------------------------------

const ROUTES = {
  'app/api/narrate/route.js': 'narrate',
  'app/api/ask/route.js': 'ask',
  'app/api/measure/route.js': 'measure',
  'app/api/speech/route.js': 'speech',
  'app/api/export/pdf/route.js': 'pdf',
  'app/api/connect/route.js': 'connect',
  'app/api/analyses/[id]/share/route.js': 'shareNotify',
};

/** Buckets that guard something other than cost, checked separately. */
const DISCLOSURE_ROUTES = {
  'app/api/analyses/[id]/share/route.js': 'share',
};

test('every route that costs money charges itself against a bucket', () => {
  for (const [path, bucket] of Object.entries(ROUTES)) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.match(
      source,
      new RegExp(`enforceLimit\\(request, '${bucket}'\\)`),
      `${path} must charge against the "${bucket}" bucket`
    );
  }
});

test('no route charges against a bucket that does not exist', () => {
  // A typo'd name would throw at runtime rather than silently skip the limit,
  // but finding that out in production is not the plan.
  for (const path of Object.keys(ROUTES)) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    for (const [, bucket] of source.matchAll(/enforceLimit\(request, '([^']+)'\)/g)) {
      assert.ok(bucket in LIMITS, `${path} uses an unknown bucket "${bucket}"`);
    }
  }
});

test('sharing by email is rate limited, because the message is an oracle', () => {
  // The wording is deliberate — it tells the caller whether an address has an
  // account, which is what someone sharing actually needs to know. The limit is
  // what stops that from scaling into a way to walk a list of addresses, and it
  // is the only thing that does: a share that lands returns 200 and one that
  // does not returns 400, so the signal survives any rewording.
  for (const [path, bucket] of Object.entries(DISCLOSURE_ROUTES)) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.match(
      source,
      new RegExp(`enforceLimit\\(request, '${bucket}'\\)`),
      `${path} must charge against the "${bucket}" bucket`
    );
  }
  assert.ok(LIMITS.share, 'the share bucket exists');
  assert.ok(LIMITS.share.limit >= 20, 'generous enough that real sharing never hits it');
  assert.ok(LIMITS.share.limit <= 60, 'tight enough that enumeration is not practical');
});

test('the helpful message survives — the limit is what bounds it, not the wording', () => {
  // Guards the decision itself. If someone later softens this to a generic
  // failure they should do it deliberately, not because it looked like a leak.
  const source = readFileSync(new URL('../lib/analyses.server.js', import.meta.url), 'utf8');
  assert.match(source, /No account here uses \$\{parsed\.value\}\. Ask them to sign up first\./);
});
