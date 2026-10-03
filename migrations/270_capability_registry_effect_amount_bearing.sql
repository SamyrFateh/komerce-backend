-- @migration 270_capability_registry_effect_amount_bearing.sql
-- @domain    market-delegation
-- @purpose   Market Control Plane, PR C1. Declare for every capability its
--            effect (READ never modifies, ACT acts) and whether it carries an
--            amount. The effect decides what a SUSPENDED market still allows
--            (READ yes, ACT no, plan F4); amount_bearing marks the only
--            capabilities that may later receive a financial limit (plan F3).
--            Both are declared in config/market-delegation-capabilities.js
--            one capability at a time and never deduced from the name.
--
-- This migration changes no authorization decision: nothing reads these two
-- columns yet. It writes no membership, ceiling, assignment or audit row, and
-- deletes nothing. Default 'ACT' is the safe side for a capability inserted
-- by a later migration before it declares its effect (the registry check
-- fails until the config declares it).

ALTER TABLE capability_registry
  ADD COLUMN IF NOT EXISTS effect text NOT NULL DEFAULT 'ACT',
  ADD COLUMN IF NOT EXISTS amount_bearing boolean NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'capability_registry_effect_check'
  ) THEN
    ALTER TABLE capability_registry
      ADD CONSTRAINT capability_registry_effect_check CHECK (effect IN ('READ', 'ACT'));
  END IF;
END
$$;

UPDATE capability_registry
   SET effect = 'READ', updated_at = NOW()
 WHERE capability IN (
  'pricing.read',
  'dashboard.market.read',
  'operations.read',
  'logistics.read',
  'client.read',
  'team.read',
  'network.read',
  'market_config.read',
  'finance.read',
  'catalog.read',
  'dashboard.global.read'
 )
   AND effect <> 'READ';

UPDATE capability_registry
   SET amount_bearing = TRUE, updated_at = NOW()
 WHERE capability IN ('execution.cash.confirm', 'finance.act', 'settlement.receive')
   AND amount_bearing IS DISTINCT FROM TRUE;
