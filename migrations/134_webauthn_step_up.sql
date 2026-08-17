-- @migration 134_webauthn_step_up.sql
-- @domain    auth-passkey
-- @purpose   AUTH-7 — distinguer cryptographiquement la cérémonie step-up
--            des cérémonies register/login. Jamais de DDL runtime.

ALTER TABLE webauthn_challenges
  DROP CONSTRAINT IF EXISTS webauthn_challenges_ceremony_type_check;

ALTER TABLE webauthn_challenges
  ADD CONSTRAINT webauthn_challenges_ceremony_type_check
  CHECK (ceremony_type IN ('register', 'login', 'step_up'));

COMMENT ON COLUMN webauthn_challenges.ceremony_type IS
  'Cérémonie WebAuthn : register, login ou step_up. AUTH-7 interdit le croisement des challenges.';
