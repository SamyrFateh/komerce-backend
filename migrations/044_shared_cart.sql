-- ============================================================
-- Migration 044 : Panier Partagé Komerce (MVP Niveau 1)
-- Date : avril 2026
-- Version ASCII pure
--
-- OBJECTIF :
--   Permettre a un beneficiaire de partager son panier pour que
--   plusieurs proches contribuent librement par carte bancaire.
--   Le beneficiaire peut completer le reste en cash au relais.
--
-- DOCTRINE : "Komerce transforme l'aide familiale en achat
--             visible, tracable et livre."
--
-- TABLES :
--   1. shared_carts             : panier partage (snapshot fige)
--   2. shared_cart_items        : items snapshot fige
--   3. shared_cart_contributions: paiements des contributeurs
--   4. shared_cart_events       : audit log
--
-- + Extension de la table orders pour supporter le paiement mixte
--   (contributions diaspora + cash relais)
--
-- IDEMPOTENT.
-- ============================================================

SET client_encoding = 'UTF8';

-- ============================================================
-- 1. ENUM types
-- ============================================================

-- Statut d'un panier partage
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shared_cart_status') THEN
    CREATE TYPE shared_cart_status AS ENUM (
      'draft',                 -- en preparation, pas encore actif
      'active',                -- partageable, accepte contributions
      'partially_funded',      -- au moins 1 contribution recue
      'fully_funded',          -- 100% atteint
      'converted_to_order',    -- finalise en commande
      'expired',               -- depasse expires_at sans finalisation
      'cancelled',             -- annule par beneficiaire ou admin
      'refunded'               -- contributions remboursees
    );
  END IF;
END $$;

-- Statut d'une contribution
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shared_cart_contribution_status') THEN
    CREATE TYPE shared_cart_contribution_status AS ENUM (
      'pending',     -- contribution demarree, en attente paiement Stripe
      'paid',        -- paiement Stripe confirme via webhook
      'failed',      -- echec paiement
      'refunded',    -- contribution remboursee
      'cancelled'    -- annule avant paiement
    );
  END IF;
END $$;

-- Etendre l'enum payment_mode avec le mode mixte
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum WHERE enumlabel = 'mixed_shared_cart_cash'
       AND enumtypid = 'payment_mode'::regtype
  ) THEN
    ALTER TYPE payment_mode ADD VALUE 'mixed_shared_cart_cash';
  END IF;
END $$;

-- Etendre payment_status avec partially_paid
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum WHERE enumlabel = 'partially_paid'
       AND enumtypid = 'payment_status'::regtype
  ) THEN
    ALTER TYPE payment_status ADD VALUE 'partially_paid';
  END IF;
END $$;

-- ============================================================
-- 2. Table shared_carts (panier partage)
-- ============================================================
CREATE TABLE IF NOT EXISTS shared_carts (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Token public (URL : /cart/shared/:token)
  -- 16 caracteres URL-safe Base58, non devinable, unique
  token                       TEXT UNIQUE NOT NULL,

  -- Beneficiaire (qui recoit la commande au final)
  beneficiary_user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  beneficiary_phone_snapshot  TEXT,
  beneficiary_name_snapshot   TEXT,

  -- Origine (basket source si applicable, peut etre null si cree directement)
  source_basket_id            UUID REFERENCES baskets(id) ON DELETE SET NULL,

  -- Affichage
  title                       TEXT,
  message                     TEXT,

  -- Snapshot financier (FIGE au partage, jamais recalcule depuis les products)
  currency_snapshot           TEXT NOT NULL DEFAULT 'KMF',
  total_kmf_snapshot          INTEGER NOT NULL CHECK (total_kmf_snapshot > 0),
  contributed_kmf             INTEGER NOT NULL DEFAULT 0 CHECK (contributed_kmf >= 0),
  remaining_kmf               INTEGER NOT NULL CHECK (remaining_kmf >= 0),

  -- Livraison (optionnel : peut etre rempli a la finalisation)
  delivery_island             TEXT,
  delivery_relay_id           UUID REFERENCES relais(id) ON DELETE SET NULL,

  -- Cycle de vie
  status                      shared_cart_status NOT NULL DEFAULT 'draft',
  expires_at                  TIMESTAMPTZ NOT NULL,
  finalized_at                TIMESTAMPTZ,
  cancelled_at                TIMESTAMPTZ,

  -- Lien vers la commande finale si finalise
  finalized_order_id          UUID REFERENCES orders(id) ON DELETE SET NULL,

  -- Tracking
  view_count                  INTEGER NOT NULL DEFAULT 0,

  -- Audit / metadata
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata                    JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_shared_carts_token         ON shared_carts(token);
CREATE INDEX IF NOT EXISTS idx_shared_carts_beneficiary   ON shared_carts(beneficiary_user_id, status);
CREATE INDEX IF NOT EXISTS idx_shared_carts_status        ON shared_carts(status, expires_at);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_shared_carts_updated') THEN
    CREATE TRIGGER trg_shared_carts_updated BEFORE UPDATE ON shared_carts
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ============================================================
-- 3. Table shared_cart_items (snapshot fige)
-- ============================================================
CREATE TABLE IF NOT EXISTS shared_cart_items (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shared_cart_id                UUID NOT NULL REFERENCES shared_carts(id) ON DELETE CASCADE,

  -- Reference produit (peut etre null si le produit est supprime ensuite)
  product_id                    UUID REFERENCES products(id) ON DELETE SET NULL,

  -- Snapshot fige : ces valeurs ne changent PLUS jamais apres creation
  product_name_snapshot         TEXT NOT NULL,
  product_image_snapshot        TEXT,
  product_category_snapshot     TEXT,
  quantity                      INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_kmf_snapshot       INTEGER NOT NULL CHECK (unit_price_kmf_snapshot >= 0),
  line_total_kmf_snapshot       INTEGER NOT NULL CHECK (line_total_kmf_snapshot >= 0),

  -- Audit
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata                      JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_shared_cart_items_cart ON shared_cart_items(shared_cart_id);

-- ============================================================
-- 4. Table shared_cart_contributions
-- ============================================================
CREATE TABLE IF NOT EXISTS shared_cart_contributions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shared_cart_id              UUID NOT NULL REFERENCES shared_carts(id) ON DELETE RESTRICT,

  -- Identite contributeur (non authentifie volontairement, juste declaratif)
  contributor_name            TEXT NOT NULL,
  contributor_email           TEXT NOT NULL,
  contributor_phone           TEXT,
  message                     TEXT,

  -- Montants : on stocke les 3 vues (paye, KMF affiche au beneficiaire, taux applique)
  amount_kmf                  INTEGER NOT NULL CHECK (amount_kmf > 0),
  amount_paid                 NUMERIC(12,2) NOT NULL CHECK (amount_paid > 0),
  currency_paid               TEXT NOT NULL DEFAULT 'EUR',
  fx_rate_used                NUMERIC(12,6),

  -- Frais Stripe (estimes au moment de la creation, reels apres confirmation)
  stripe_fee_estimated        NUMERIC(10,2),
  stripe_fee_real             NUMERIC(10,2),

  -- Liaison Stripe (idempotence !)
  stripe_session_id           TEXT UNIQUE,
  stripe_payment_intent_id    TEXT,

  -- Cycle de vie
  status                      shared_cart_contribution_status NOT NULL DEFAULT 'pending',
  paid_at                     TIMESTAMPTZ,
  refunded_at                 TIMESTAMPTZ,
  failed_at                   TIMESTAMPTZ,

  -- Audit
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata                    JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_contributions_cart    ON shared_cart_contributions(shared_cart_id, status);
CREATE INDEX IF NOT EXISTS idx_contributions_session ON shared_cart_contributions(stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_contributions_email   ON shared_cart_contributions(contributor_email);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_contributions_updated') THEN
    CREATE TRIGGER trg_contributions_updated BEFORE UPDATE ON shared_cart_contributions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ============================================================
-- 5. Table shared_cart_events (audit log)
-- ============================================================
CREATE TABLE IF NOT EXISTS shared_cart_events (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shared_cart_id              UUID NOT NULL REFERENCES shared_carts(id) ON DELETE CASCADE,
  event_type                  TEXT NOT NULL,
  actor_type                  TEXT,                -- 'user' / 'contributor' / 'admin' / 'system' / 'stripe'
  actor_id                    UUID,                -- nullable
  payload                     JSONB DEFAULT '{}'::jsonb,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shared_cart_events_cart
  ON shared_cart_events(shared_cart_id, created_at DESC);

-- ============================================================
-- 6. Extension de la table orders pour le paiement mixte
-- ============================================================
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shared_cart_id        UUID REFERENCES shared_carts(id) ON DELETE SET NULL;
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS prepaid_amount_kmf    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS remaining_cash_kmf    INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_orders_shared_cart ON orders(shared_cart_id);

-- ============================================================
-- 7. Verifications + log
-- ============================================================
DO $$
BEGIN
  RAISE NOTICE 'Migration 044 OK : Panier Partage MVP';
  RAISE NOTICE '  - Tables creees : shared_carts, shared_cart_items, shared_cart_contributions, shared_cart_events';
  RAISE NOTICE '  - Enums : shared_cart_status, shared_cart_contribution_status';
  RAISE NOTICE '  - payment_mode etendu : mixed_shared_cart_cash';
  RAISE NOTICE '  - payment_status etendu : partially_paid';
  RAISE NOTICE '  - orders etendue : shared_cart_id, prepaid_amount_kmf, remaining_cash_kmf';
END $$;
