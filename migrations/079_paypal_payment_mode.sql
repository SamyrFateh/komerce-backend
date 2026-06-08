-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 079 — PayPal (Paiement diaspora France + Pay-in-4)
--
-- Objectif : ajouter le support PayPal en parallèle de Stripe sans toucher
-- à la machine d'état (I-01) ni au hub de paiement (I-02). Le seul changement
-- de doctrine est l'ajout d'une nouvelle source de transition `paypal_capture`
-- traitée en parallèle de `stripe_webhook` (cf. ZONE_IMPACT §I-02).
--
-- Convention ENUM (FRESH-107) : cette migration n'utilise PAS la nouvelle
-- valeur d'ENUM dans son propre INSERT/UPDATE — elle se contente de l'ajouter.
-- La logique consommatrice doit attendre que cette migration soit committée.
--
-- Structure : DEUX transactions séparées (limitation PostgreSQL — un ADD VALUE
-- ne peut pas être utilisé dans la même transaction que sa création).
-- ─────────────────────────────────────────────────────────────────────────────

SET client_encoding = 'UTF8';

-- ═══ Transaction 1 — ADD VALUE seul ════════════════════════════════════════
BEGIN;

-- Garde-fou : skip si payment_mode n'existe pas (devrait être créé bien avant)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_mode') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum
      WHERE enumlabel = 'paypal_eur'
        AND enumtypid = 'payment_mode'::regtype
    ) THEN
      ALTER TYPE payment_mode ADD VALUE 'paypal_eur';
      RAISE NOTICE 'Migration 079 : payment_mode += paypal_eur';
    ELSE
      RAISE NOTICE 'Migration 079 : paypal_eur déjà présent — skip ADD VALUE';
    END IF;
  ELSE
    RAISE NOTICE 'Migration 079 : payment_mode ENUM introuvable — skip';
  END IF;
END $$;

COMMIT;

-- ═══ Transaction 2 — colonnes orders + table idempotence ═══════════════════
BEGIN;

-- Colonnes PayPal sur orders (cohérent avec stripe_payment_id/stripe_payer_email)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paypal_order_id      TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paypal_capture_id    TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paypal_payer_email   TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paypal_payer_id      TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paypal_pay_in_4_used BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_orders_paypal_order_id
  ON orders(paypal_order_id) WHERE paypal_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_paypal_capture_id
  ON orders(paypal_capture_id) WHERE paypal_capture_id IS NOT NULL;

COMMENT ON COLUMN orders.paypal_order_id      IS 'PayPal Order ID (avant capture) — pattern: 8 chars majuscules + chiffres';
COMMENT ON COLUMN orders.paypal_capture_id    IS 'PayPal Capture ID (après approval) — utilisé pour refund via /v2/payments/captures/:id/refund';
COMMENT ON COLUMN orders.paypal_payer_email   IS 'Email PayPal du payeur diaspora (≠ user.email — l''email enregistré peut différer)';
COMMENT ON COLUMN orders.paypal_payer_id      IS 'PayPal Payer ID (Account ID PayPal du payeur) — pour traçabilité litige';
COMMENT ON COLUMN orders.paypal_pay_in_4_used IS 'TRUE si le payeur a choisi Pay-in-4 (utile pour suivi conversion diaspora)';

-- Table d'idempotence webhook PayPal (jumeau de stripe_events_processed)
-- Garantit I-07 : pas de double traitement d'un webhook PayPal.
CREATE TABLE IF NOT EXISTS paypal_events_processed (
  event_id        TEXT PRIMARY KEY,
  event_type      TEXT NOT NULL,
  processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload_summary JSONB,
  -- Audit : tracker les events ignorés (pas une erreur, juste de la visibilité)
  status          TEXT NOT NULL DEFAULT 'processed'
    CHECK (status IN ('processed', 'ignored', 'rejected', 'noop'))
);

CREATE INDEX IF NOT EXISTS idx_paypal_events_type_time
  ON paypal_events_processed(event_type, processed_at DESC);

COMMENT ON TABLE paypal_events_processed IS
  'Idempotence I-07 pour les webhooks PayPal. Tout event_id traité est marqué ici DANS la même transaction que la confirmation paiement.';

COMMIT;
