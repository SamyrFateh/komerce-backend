-- ================================================================
-- Migration 059 : Commande Groupee Komerce (MVP)
-- Date : mai 2026
-- ASCII pur.
--
-- DOCTRINE :
--   Une commande groupee est une commande FIGEE financee
--   par plusieurs contributions.
--   Le panier est fige APRES que le createur a valide sa commande.
--   La commande passe en statut pending_group_payment.
--   Elle n'est confirmee qu'a 100% finance + sourcing OK.
--
-- Extension de shared_carts (044) uniquement.
-- ================================================================

SET client_encoding = 'UTF8';

-- 1. Nouveau statut orders : pending_group_payment
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum
    WHERE enumlabel = 'pending_group_payment'
    AND enumtypid = 'order_status'::regtype)
  THEN ALTER TYPE order_status ADD VALUE 'pending_group_payment' AFTER 'pending';
  END IF;
END $$;

-- 2. Nouveaux statuts shared_cart_status
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'funded'
    AND enumtypid = 'shared_cart_status'::regtype)
  THEN ALTER TYPE shared_cart_status ADD VALUE 'funded' AFTER 'fully_funded'; END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'sourcing_check'
    AND enumtypid = 'shared_cart_status'::regtype)
  THEN ALTER TYPE shared_cart_status ADD VALUE 'sourcing_check' AFTER 'funded'; END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'adjustment_required'
    AND enumtypid = 'shared_cart_status'::regtype)
  THEN ALTER TYPE shared_cart_status ADD VALUE 'adjustment_required' AFTER 'sourcing_check'; END IF;
END $$;

-- 3. Colonnes supplementaires shared_carts
ALTER TABLE shared_carts ADD COLUMN IF NOT EXISTS
  source_order_id UUID REFERENCES orders(id) ON DELETE SET NULL;

ALTER TABLE shared_carts ADD COLUMN IF NOT EXISTS
  split_mode TEXT NOT NULL DEFAULT 'free'
    CHECK (split_mode IN ('free', 'equal'));

ALTER TABLE shared_carts ADD COLUMN IF NOT EXISTS
  suggested_share_kmf INTEGER
    CHECK (suggested_share_kmf IS NULL OR suggested_share_kmf > 0);

ALTER TABLE shared_carts ADD COLUMN IF NOT EXISTS
  expected_participants INTEGER
    CHECK (expected_participants IS NULL OR expected_participants > 0);

ALTER TABLE shared_carts ADD COLUMN IF NOT EXISTS
  sourcing_checked_at TIMESTAMPTZ;

ALTER TABLE shared_carts ADD COLUMN IF NOT EXISTS
  sourcing_note TEXT;

-- 4. Index
CREATE INDEX IF NOT EXISTS idx_shared_carts_source_order
  ON shared_carts(source_order_id) WHERE source_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shared_carts_funded
  ON shared_carts(status)
  WHERE status IN ('funded', 'sourcing_check', 'adjustment_required');

-- 5. Vue v_group_orders
CREATE OR REPLACE VIEW v_group_orders AS
SELECT
  sc.id, sc.token, sc.title, sc.status, sc.split_mode,
  sc.suggested_share_kmf, sc.expected_participants, sc.source_order_id,
  sc.total_kmf_snapshot    AS total_kmf,
  sc.contributed_kmf       AS paid_kmf,
  sc.remaining_kmf,
  ROUND(100.0 * sc.contributed_kmf / NULLIF(sc.total_kmf_snapshot,0))::int AS funded_pct,
  sc.expires_at, sc.finalized_at, sc.finalized_order_id, sc.sourcing_note,
  sc.beneficiary_user_id, sc.beneficiary_name_snapshot, sc.delivery_relay_id,
  sc.created_at, sc.updated_at,
  (SELECT COUNT(*)::int FROM shared_cart_contributions scc
   WHERE scc.shared_cart_id = sc.id AND scc.status = 'paid')    AS contributors_paid,
  (SELECT COUNT(*)::int FROM shared_cart_contributions scc
   WHERE scc.shared_cart_id = sc.id AND scc.status = 'pending') AS contributors_pending,
  o.reference AS source_order_reference,
  o.status    AS source_order_status
FROM shared_carts sc
LEFT JOIN orders o ON o.id = sc.source_order_id;

DO $$ BEGIN
  RAISE NOTICE 'Migration 059 OK : Commande Groupee MVP';
END $$;
