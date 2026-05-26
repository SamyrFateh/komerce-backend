-- ============================================================
-- Migration 074 : Shared cart v4 — nouveaux statuts du cycle de vie
-- Date : mai 2026
--
-- La doctrine v4.1 introduit une machine d'état enrichie :
--   commitment_open         : phase de concertation (engagements indicatifs)
--   closed_for_settlement   : créateur a lancé le règlement, engagements figés
--   settlement_in_progress  : paiements participants en cours
--   ready_to_finalize       : tous les paiements attendus reçus ou compensés
--
-- Ces valeurs remplacent l'usage transitoire de metadata.settlement_open=true
-- (shared-cart-v4-settlement.js : "implémentation transitionnelle").
--
-- IDEMPOTENT — ADD VALUE IF NOT EXISTS.
-- ============================================================

SET client_encoding = 'UTF8';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'commitment_open'
      AND enumtypid = 'shared_cart_status'::regtype
  ) THEN
    ALTER TYPE shared_cart_status ADD VALUE 'commitment_open';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'closed_for_settlement'
      AND enumtypid = 'shared_cart_status'::regtype
  ) THEN
    ALTER TYPE shared_cart_status ADD VALUE 'closed_for_settlement';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'settlement_in_progress'
      AND enumtypid = 'shared_cart_status'::regtype
  ) THEN
    ALTER TYPE shared_cart_status ADD VALUE 'settlement_in_progress';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'ready_to_finalize'
      AND enumtypid = 'shared_cart_status'::regtype
  ) THEN
    ALTER TYPE shared_cart_status ADD VALUE 'ready_to_finalize';
  END IF;
END $$;

DO $$
BEGIN
  RAISE NOTICE 'Migration 074 OK : shared_cart_status enrichi (commitment_open, closed_for_settlement, settlement_in_progress, ready_to_finalize)';
END $$;
