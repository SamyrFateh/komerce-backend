-- @migration 171_kartapay_km_mobile_money.sql
-- @domain    payment
-- @purpose   Ajoute KartaPay comme provider Mobile Money du marché Comores (KM/KMF).
--
-- KartaPay reste fail-closed côté runtime tant que les credentials staging/prod
-- complets ne sont pas présents. L'activation DB n'implique donc jamais qu'un
-- paiement soit affiché comme disponible si l'adapter n'est pas configuré.

ALTER TABLE market_payment_providers
  DROP CONSTRAINT IF EXISTS market_payment_provider_chk;

ALTER TABLE market_payment_providers
  ADD CONSTRAINT market_payment_provider_chk
  CHECK (provider IN ('orange_money', 'mtn_momo', 'kartapay'));

ALTER TABLE mobile_money_transactions
  DROP CONSTRAINT IF EXISTS mobile_money_provider_chk;

ALTER TABLE mobile_money_transactions
  ADD CONSTRAINT mobile_money_provider_chk
  CHECK (provider IN ('orange_money', 'mtn_momo', 'kartapay'));

INSERT INTO market_payment_providers (
  market_id, provider, currency, is_enabled, priority
)
SELECT id, 'kartapay', 'KMF', true, 10
FROM markets
WHERE code = 'KM'
ON CONFLICT (market_id, provider) DO UPDATE
SET currency = EXCLUDED.currency,
    is_enabled = EXCLUDED.is_enabled,
    priority = EXCLUDED.priority,
    updated_at = NOW();

COMMENT ON TABLE market_payment_providers IS
  'Providers Mobile Money autorisés par marché. KM utilise KartaPay comme gateway vers MVola/Holo ; credentials exclusivement runtime.';
