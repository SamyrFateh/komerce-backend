-- ============================================================
-- Migration 071 : Cash contributions for shared carts
-- Date : 2026-05-26
--
-- Doctrine:
--   Stripe contribution: pending -> paid via webhook.
--   Cash contribution: pending_cash -> paid via agent/admin confirmation.
--
-- A pending cash contribution is only a promise/intention.
-- It must never increment shared_carts.contributed_kmf until confirmed.
-- ============================================================

SET client_encoding = 'UTF8';

-- Add pending_cash to contribution status enum.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumlabel = 'pending_cash'
      AND enumtypid = 'shared_cart_contribution_status'::regtype
  ) THEN
    ALTER TYPE shared_cart_contribution_status ADD VALUE 'pending_cash';
  END IF;
END $$;

ALTER TABLE shared_cart_contributions
  ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'stripe';

ALTER TABLE shared_cart_contributions
  ADD COLUMN IF NOT EXISTS cash_reference TEXT;

ALTER TABLE shared_cart_contributions
  ADD COLUMN IF NOT EXISTS cash_relais_id UUID REFERENCES relais(id) ON DELETE SET NULL;

ALTER TABLE shared_cart_contributions
  ADD COLUMN IF NOT EXISTS cash_confirmed_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE shared_cart_contributions
  ADD COLUMN IF NOT EXISTS cash_confirmed_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_shared_cart_contrib_cash_reference
  ON shared_cart_contributions(cash_reference)
  WHERE cash_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shared_cart_contrib_cash_pending
  ON shared_cart_contributions(status, payment_method, created_at)
  WHERE payment_method = 'cash';

DO $$ BEGIN
  RAISE NOTICE 'Migration 071 OK : shared cart cash contributions enabled';
END $$;
