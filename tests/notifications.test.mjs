import test from 'node:test';
import assert from 'node:assert/strict';
import {
  badgeLabel,
  isUnread,
  relativeTime,
  senderName,
  shareNotification,
  unreadCount,
} from '../lib/notifications.js';

/* What a notification says, and how many of them are new.

   The counting is the part worth pinning: a bell is a claim about how much
   somebody has missed, and a badge that is wrong in either direction is worse
   than no badge — too high nags about things already read, too low hides the
   share the whole feature exists to announce. */

test('a share names whoever sent it, in the order a reader would prefer', () => {
  assert.equal(senderName({ display_name: 'Sam Okafor', handle: 'sam' }), 'Sam Okafor');
  assert.equal(senderName({ display_name: '   ', handle: 'sam' }), '@sam', 'blank is not a name');
  assert.equal(senderName({ handle: 'sam' }), '@sam');

  // No username at all. This app does not publish one user's email address to
  // another, so there is genuinely nothing else to show — and "unknown" would
  // read as a fault rather than as that fact.
  assert.equal(senderName(null), 'Someone');
  assert.equal(senderName({}), 'Someone');
});

test('a notification is built from the share and the owner behind it', () => {
  const n = shareNotification(
    { analysisId: 'a1', at: '2026-09-19T10:00:00.000Z' },
    { profile: { display_name: 'Sam' }, title: 'Q3 churn', datasetName: 'churn.csv' }
  );

  assert.equal(n.kind, 'share');
  assert.equal(n.analysisId, 'a1');
  assert.equal(n.message, 'Sam shared “Q3 churn” with you');
  assert.equal(n.datasetName, 'churn.csv');

  // The id is the share's own identity. The pair is the share table's primary
  // key, so re-sharing upserts that row and leaves its timestamp alone —
  // somebody who already has access does not get told twice.
  assert.equal(n.id, 'a1:2026-09-19T10:00:00.000Z');
});

test('an analysis with no title still says something', () => {
  const n = shareNotification({ analysisId: 'a1', at: '2026-09-19T10:00:00.000Z' }, { title: '   ' });
  assert.equal(n.message, 'Someone shared “an analysis” with you');
});

test('unread is everything newer than the last look', () => {
  const feed = [
    { at: '2026-09-19T12:00:00.000Z' },
    { at: '2026-09-19T11:00:00.000Z' },
    { at: '2026-09-19T09:00:00.000Z' },
  ];

  assert.equal(unreadCount(feed, '2026-09-19T10:00:00.000Z'), 2);
  assert.equal(unreadCount(feed, '2026-09-19T12:00:00.000Z'), 0, 'the marker itself is not unread');
  assert.equal(unreadCount([], '2026-09-19T10:00:00.000Z'), 0);

  // Never looked. Everything is new, which is the honest answer for somebody
  // who has never opened the menu — not zero, which would hide the first share
  // anybody ever received.
  assert.equal(unreadCount(feed, null), 3);
  assert.equal(unreadCount(feed, 'not a date'), 3, 'an unreadable marker is no marker');
});

test('one notification knows whether it is new', () => {
  const fresh = { at: '2026-09-19T12:00:00.000Z' };
  const old = { at: '2026-09-19T08:00:00.000Z' };
  assert.equal(isUnread(fresh, '2026-09-19T10:00:00.000Z'), true);
  assert.equal(isUnread(old, '2026-09-19T10:00:00.000Z'), false);
  assert.equal(isUnread(old, null), true);
});

test('the badge is readable at sixteen pixels', () => {
  assert.equal(badgeLabel(0), '');
  assert.equal(badgeLabel(-1), '');
  assert.equal(badgeLabel(7), '7');
  assert.equal(badgeLabel(99), '99');
  // Three digits in that circle is a smudge, and nobody does anything
  // different about 140 than about 99.
  assert.equal(badgeLabel(140), '99+');
});

test('how long ago, in the words somebody would use out loud', () => {
  const now = Date.parse('2026-09-19T12:00:00.000Z');
  const ago = (ms) => relativeTime(new Date(now - ms).toISOString(), now);

  assert.equal(ago(5_000), 'just now');
  assert.equal(ago(60_000), '1 minute ago');
  assert.equal(ago(5 * 60_000), '5 minutes ago');
  assert.equal(ago(60 * 60_000), '1 hour ago');
  assert.equal(ago(3 * 60 * 60_000), '3 hours ago');
  assert.equal(ago(24 * 60 * 60_000), '1 day ago');
  assert.equal(ago(3 * 24 * 60 * 60_000), '3 days ago');

  // Past a week it gives the date. "23 days ago" is arithmetic the reader then
  // has to do again to place it against anything they remember.
  assert.match(ago(23 * 24 * 60 * 60_000), /2026/);
  assert.equal(relativeTime('nonsense'), '');
});
