-- @migration 405_wallet_multi_currency.sql
-- @domain    wallet,orders
-- @purpose   Wallet multi-devise : un solde par (utilisateur, devise), aucune conversion implicite entre soldes.
-- @added-header 2026-11-12
--
-- Les colonnes *_kmf ne sont pas renommées (contrat historique) : pour un wallet dont `currency` <> 'KMF', elles
-- portent des unités de CETTE devise. Les wallets existants sont tous KMF (défaut).

ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'KMF';

ALTER TABLE public.wallets
  DROP CONSTRAINT IF EXISTS chk_wallets_currency_format;
ALTER TABLE public.wallets
  ADD CONSTRAINT chk_wallets_currency_format CHECK (currency ~ '^[A-Z]{3}$');

ALTER TABLE public.wallets DROP CONSTRAINT IF EXISTS wallets_user_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS ux_wallets_user_currency ON public.wallets (user_id, currency);
