-- ---------------------------------------------------------------------------
-- Let a challenge be raised for a password reset.
-- ---------------------------------------------------------------------------
--
-- `auth_challenges.purpose` allowed only 'signup' and 'signin'. The recovery
-- flow raises a third kind, so every reset request failed on this constraint,
-- inside a `try` whose whole job is to reveal nothing about whether an address
-- has an account — and therefore revealed nothing about this either. The route
-- returned "a code is on its way", no mail was sent, and nobody was told.
--
-- The constraint was right to exist and right to be narrow: it is what stops a
-- caller inventing a purpose the verify route has no branch for. It just needed
-- to know about the branch that was added.

alter table app_private.auth_challenges
  drop constraint auth_challenges_purpose_check;

alter table app_private.auth_challenges
  add constraint auth_challenges_purpose_check
  check (purpose in ('signup', 'signin', 'recover'));
