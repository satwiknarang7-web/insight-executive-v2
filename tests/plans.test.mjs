/**
 * The plan vocabulary.
 *
 * Small surface, but it is the one every gate in the app and on the server asks
 * its question through, so the failure mode of a mistake here is "the paid
 * feature was free" or "the paying customer was locked out". Both directions
 * are tested explicitly rather than assumed from one example.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BUILD_MODES,
  FREE,
  PLANS,
  PLAN_IDS,
  PRO,
  buildModesFor,
  normalizePlan,
  planAllows,
  planInfo,
} from '../lib/plans.js';

test('an unrecognised plan is free, never the generous one', () => {
  for (const value of [null, undefined, '', 'pro-trial', 'enterprise', 'PRO ', 0, {}, []]) {
    if (value === 'PRO ') continue; // handled below, it is a real plan badly typed
    assert.equal(normalizePlan(value), FREE, `${JSON.stringify(value)} should read as free`);
  }
});

test('a real plan survives sloppy casing and whitespace', () => {
  assert.equal(normalizePlan('PRO '), PRO);
  assert.equal(normalizePlan('  Pro'), PRO);
  assert.equal(normalizePlan('FREE'), FREE);
});

test('free may build by hand and may not reach a model', () => {
  assert.equal(planAllows(FREE, 'manualDashboard'), true);
  assert.equal(planAllows(FREE, 'model'), false);
  assert.equal(planAllows(FREE, 'autoAnalysis'), false);
});

test('pro may do everything free may, and the rest', () => {
  for (const capability of Object.keys(PLANS[FREE].capabilities)) {
    if (planAllows(FREE, capability)) {
      assert.equal(planAllows(PRO, capability), true, `pro lost ${capability}`);
    }
  }
  assert.equal(planAllows(PRO, 'model'), true);
  assert.equal(planAllows(PRO, 'autoAnalysis'), true);
});

test('an unknown capability is refused, not assumed', () => {
  // A typo in a gate must close it. `planAllows(plan, 'modle')` returning true
  // would open every route that guarded itself with it.
  assert.equal(planAllows(PRO, 'modle'), false);
  assert.equal(planAllows(PRO, ''), false);
  assert.equal(planAllows(PRO, undefined), false);
});

test('an unknown plan is refused everything a paid plan has', () => {
  assert.equal(planAllows('enterprise', 'model'), false);
  assert.equal(planAllows(undefined, 'autoAnalysis'), false);
});

test('planInfo always returns a plan to draw', () => {
  for (const value of [null, 'nonsense', FREE, PRO]) {
    const info = planInfo(value);
    assert.ok(info, `no info for ${value}`);
    assert.ok(info.name, 'a plan must have a name');
    assert.ok(PLAN_IDS.includes(info.id));
  }
});

test('every plan declares every capability, so none is undefined by omission', () => {
  const names = new Set();
  for (const id of PLAN_IDS) for (const key of Object.keys(PLANS[id].capabilities)) names.add(key);

  for (const id of PLAN_IDS) {
    for (const name of names) {
      assert.equal(
        typeof PLANS[id].capabilities[name],
        'boolean',
        `${id} does not say either way about ${name}`
      );
    }
  }
});

test('free is offered one way to start a dataset, pro is offered both', () => {
  const free = buildModesFor(FREE).map((m) => m.id);
  const pro = buildModesFor(PRO).map((m) => m.id);

  assert.deepEqual(free, ['scratch']);
  assert.deepEqual(pro.sort(), ['assisted', 'scratch']);
});

test('every build mode names a capability that exists', () => {
  const known = new Set(Object.keys(PLANS[PRO].capabilities));
  for (const mode of Object.values(BUILD_MODES)) {
    assert.ok(known.has(mode.requires), `${mode.id} requires unknown capability ${mode.requires}`);
  }
});

test('the free plan says out loud what it does not include', () => {
  // The card is generated from this, and a plan that lists only upsides leaves
  // the limit to be discovered after signing up.
  assert.ok(PLANS[FREE].excludes.length > 0);
});
