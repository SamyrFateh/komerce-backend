-- Migration 014c — Wallet foundation (LOT R2, DEBT-01)
--
-- Contexte : wallets/wallet_transactions/wallet_credit_lots/wallet_consumptions
-- n'ont jamais existé en tant que migration versionnée. Elles n'étaient créées
-- qu'au boot du serveur via services/wallet-service.js::ensureWalletTables()
-- (DDL runtime, catch-swallow silencieux). Confirmé par LOT R1 (W0-1) :
-- une base construite depuis migrations/ seules n'a jamais ces 4 tables.
--
-- Migration 066_wallet_consumptions_append_only.sql et
-- 068_wallets_check_balance.sql font déjà des ALTER TABLE sur ces objets en
-- présupposant qu'ils existent — cette migration doit donc s'exécuter AVANT
-- elles (numérotation 014c < 066/068, cf. tri numeric-aware de
-- scripts/run-migrations.js).
--
-- Contrat reproduit EXACTEMENT depuis docs/db/railway-live-schema.sql
-- (colonnes, contraintes CHECK, PRIMARY KEY, FOREIGN KEY, UNIQUE, index) —
-- rien n'est redessiné. La contrainte chk_balance_non_negative et les
-- colonnes reversed_at/reversal_reason sur wallet_consumptions restent
-- ajoutées par 068 et 066 respectivement, comme avant cette migration ;
-- cette migration ne fait que poser la fondation manquante en amont.

CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  balance_kmf INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  type VARCHAR(20) NOT NULL CHECK (type IN ('credit','debit','reversal','expiration')),
  amount_kmf INTEGER NOT NULL CHECK (amount_kmf > 0),
  balance_after_kmf INTEGER NOT NULL,
  reason VARCHAR(50) NOT NULL,
  reference_id UUID,
  idempotency_key VARCHAR(100),
  note TEXT,
  metadata JSONB DEFAULT '{}',
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallet_credit_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  transaction_id UUID NOT NULL REFERENCES wallet_transactions(id),
  original_amount_kmf INTEGER NOT NULL,
  remaining_kmf INTEGER NOT NULL CHECK (remaining_kmf >= 0),
  reason VARCHAR(50) NOT NULL,
  source_order_id UUID,
  expires_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','used','expired','reversed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallet_consumptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL,
  credit_lot_id UUID NOT NULL REFERENCES wallet_credit_lots(id),
  transaction_id UUID NOT NULL REFERENCES wallet_transactions(id),
  amount_kmf INTEGER NOT NULL CHECK (amount_kmf > 0),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallets_user
  ON wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_wtx_wallet
  ON wallet_transactions(wallet_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wtx_idempotency
  ON wallet_transactions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wlots_wallet_active
  ON wallet_credit_lots(wallet_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_wcons_order
  ON wallet_consumptions(order_id);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS wallet_applied_kmf INTEGER DEFAULT 0;
