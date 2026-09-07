-- @migration 168_mobile_money_foundation.sql
-- @domain    payment
-- @purpose   Socle Mobile Money multi-provider / multi-marché.
--
-- Doctrine : payment_mode décrit le rail Komerce (`mobile_money`) ;
-- le provider opérateur vit séparément et son activation est gouvernée
-- par le marché. Les secrets restent exclusivement dans l'environnement.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumlabel = 'mobile_money'
      AND enumtypid = 'payment_mode'::regtype
  ) THEN
    ALTER TYPE payment_mode ADD VALUE 'mobile_money';
    RAISE NOTICE 'Migration 168 : payment_mode += mobile_money';
  ELSE
    RAISE NOTICE 'Migration 168 : mobile_money déjà présent — skip ADD VALUE';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS market_payment_providers (
  market_id    uuid NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  provider     text NOT NULL,
  currency     text NOT NULL,
  is_enabled   boolean NOT NULL DEFAULT true,
  priority     integer NOT NULL DEFAULT 100 CHECK (priority > 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (market_id, provider),
  CONSTRAINT market_payment_provider_chk
    CHECK (provider IN ('orange_money', 'mtn_momo')),
  CONSTRAINT market_payment_currency_chk
    CHECK (currency ~ '^[A-Z]{3}$')
);

-- Marchés initiaux :
--   CM → Orange Money Cameroun
--   CG → MTN MoMo Congo-Brazzaville
-- L'absence de credentials runtime garde malgré tout le provider indisponible.
INSERT INTO market_payment_providers (market_id, provider, currency, is_enabled, priority)
SELECT id, 'orange_money', 'XAF', true, 10
FROM markets
WHERE code = 'CM'
ON CONFLICT (market_id, provider) DO NOTHING;

INSERT INTO market_payment_providers (market_id, provider, currency, is_enabled, priority)
SELECT id, 'mtn_momo', 'XAF', true, 10
FROM markets
WHERE code = 'CG'
ON CONFLICT (market_id, provider) DO NOTHING;

CREATE TABLE IF NOT EXISTS mobile_money_transactions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  market_id               uuid NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  provider                text NOT NULL,
  msisdn                  text,
  currency                text NOT NULL,
  minor_unit              integer NOT NULL DEFAULT 0 CHECK (minor_unit BETWEEN 0 AND 4),
  amount_minor            bigint NOT NULL CHECK (amount_minor > 0),
  external_transaction_id text,
  status                  text NOT NULL DEFAULT 'initiated',
  provider_status         text,
  provider_payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_at            timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT mobile_money_provider_chk
    CHECK (provider IN ('orange_money', 'mtn_momo')),
  CONSTRAINT mobile_money_status_chk
    CHECK (status IN ('initiated', 'pending', 'succeeded', 'failed', 'expired')),
  CONSTRAINT mobile_money_currency_chk
    CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mobile_money_provider_external_tx
  ON mobile_money_transactions(provider, external_transaction_id)
  WHERE external_transaction_id IS NOT NULL;

-- Une seule tentative active par commande/provider : protège des doubles
-- clics, replays réseau et reprises frontend avant attribution d'un ID externe.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mobile_money_active_attempt
  ON mobile_money_transactions(order_id, provider)
  WHERE status IN ('initiated', 'pending');

CREATE INDEX IF NOT EXISTS idx_mobile_money_order
  ON mobile_money_transactions(order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mobile_money_pending
  ON mobile_money_transactions(provider, status, created_at)
  WHERE status IN ('initiated', 'pending');

-- La facture doit afficher la devise réellement encaissée. Ces colonnes sont
-- additives : les factures Stripe/PayPal/cash historiques restent inchangées.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS payment_total_amount numeric(18,4),
  ADD COLUMN IF NOT EXISTS payment_currency text,
  ADD COLUMN IF NOT EXISTS payment_minor_unit integer;

COMMENT ON TABLE market_payment_providers IS
  'Providers Mobile Money autorisés par marché. Aucune credential ici : activation métier distincte de la configuration secrète runtime.';

COMMENT ON TABLE mobile_money_transactions IS
  'Transactions Mobile Money Komerce. Le provider externe ne confirme jamais directement stock/commande : passage obligatoire par order-payment-confirmation.';

COMMENT ON COLUMN invoices.payment_total_amount IS
  'Montant réellement encaissé dans payment_currency ; alimenté par les rails dont la devise n est pas déductible de total_kmf/total_eur (ex. Mobile Money XAF).';
