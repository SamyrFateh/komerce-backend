-- @migration 199_cash_confirmation_control.sql
-- @domain    payment
-- @purpose   État partagé des confirmations cash, y compris double contrôle sans montant client.

CREATE TABLE IF NOT EXISTS cash_confirmation_controls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  market_id UUID NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  relais_id UUID NOT NULL REFERENCES relais(id) ON DELETE RESTRICT,
  policy_assignment_id UUID REFERENCES market_operating_assignments(id) ON DELETE SET NULL,
  required_approvals SMALLINT NOT NULL CHECK (required_approvals IN (1,2)),
  state TEXT NOT NULL CHECK (state IN ('PENDING_SECOND','APPROVED','CONFIRMED','CANCELLED')),
  first_actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  first_source TEXT NOT NULL CHECK (char_length(btrim(first_source)) > 0),
  first_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  second_actor_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  second_source TEXT,
  second_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cash_confirmation_second_actor_distinct CHECK (
    second_actor_user_id IS NULL OR second_actor_user_id <> first_actor_user_id
  ),
  CONSTRAINT cash_confirmation_second_fields_consistent CHECK (
    (second_actor_user_id IS NULL AND second_source IS NULL AND second_at IS NULL)
    OR
    (second_actor_user_id IS NOT NULL AND second_source IS NOT NULL AND second_at IS NOT NULL)
  ),
  CONSTRAINT cash_confirmation_state_consistent CHECK (
    (state = 'PENDING_SECOND' AND required_approvals = 2 AND second_actor_user_id IS NULL AND confirmed_at IS NULL)
    OR
    (state = 'APPROVED' AND confirmed_at IS NULL AND (
       (required_approvals = 1 AND second_actor_user_id IS NULL)
       OR
       (required_approvals = 2 AND second_actor_user_id IS NOT NULL)
    ))
    OR
    (state = 'CONFIRMED' AND confirmed_at IS NOT NULL)
    OR
    (state = 'CANCELLED' AND cancelled_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_cash_confirmation_controls_market
  ON cash_confirmation_controls (market_id, state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_confirmation_controls_relais
  ON cash_confirmation_controls (relais_id, state, updated_at DESC);

COMMENT ON TABLE cash_confirmation_controls IS
  'Payment-owned control record for cash confirmation. First approval snapshots required approvals; a stricter in-flight requirement is never weakened by a later policy change.';
