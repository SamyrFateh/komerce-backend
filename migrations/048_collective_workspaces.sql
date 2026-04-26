-- ============================================================
-- Migration 048 : Panier Evenement Collectif (V1 stricte)
-- Date : avril 2026
-- Version ASCII pure
--
-- DOCTRINE V1 :
--   "Un evenement. Un panier. Des intentions libres.
--    Une session courte. Une commande seulement si tout
--    est securise. Sinon, on reprend simplement."
--
-- COEXISTENCE :
--   Cette migration ne modifie PAS la table shared_carts
--   existante (migration 044). Le systeme collective_*
--   vit en parallele avec une philosophie differente :
--     - shared_carts        = capture immediate (cagnotte)
--     - collective_*         = capture atomique 100% (zero remboursement)
--
-- TABLES :
--   1. collective_workspaces            : panier vivant
--   2. collective_workspace_items       : articles
--   3. collective_workspace_contributions : intentions libres
--   4. collective_payment_sessions      : session courte 24-72h
--   5. collective_payment_tokens        : token individuel par contributeur
--   6. collective_workspace_events      : audit log leger
--   7. stripe_events_processed          : idempotence webhook (technique)
--
-- IDEMPOTENT.
-- ============================================================

SET client_encoding = 'UTF8';

-- ============================================================
-- 1. ENUM types
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'collective_workspace_status') THEN
    CREATE TYPE collective_workspace_status AS ENUM (
      'conception',       -- panier vivant, modifiable, intentions libres
      'payment_pending',  -- session de paiement en cours
      'order_created',    -- commande creee suite a 100% securise
      'session_ended',    -- session terminee sans commande (reprise possible)
      'archived'          -- workspace abandonne
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'collective_session_status') THEN
    CREATE TYPE collective_session_status AS ENUM (
      'open',              -- tokens generes, en attente autorisations
      'ready_to_capture',  -- tous tokens authorized, capture en cours
      'paid',              -- toutes les captures reussies, commande creee
      'ended',             -- terminee sans 100% (deadline ou cancel)
      'failed'             -- erreur grave (capture partielle, etc.)
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'collective_token_status') THEN
    CREATE TYPE collective_token_status AS ENUM (
      'active',     -- token cree, paiement en attente
      'authorized', -- carte preautorisee chez Stripe
      'paid',       -- capture reussie
      'expired',    -- session expiree, autorisation annulee
      'cancelled',  -- annulee par contributeur ou createur
      'failed'      -- echec paiement (carte refusee, etc.)
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'collective_contribution_status') THEN
    CREATE TYPE collective_contribution_status AS ENUM (
      'intention',  -- intention libre, aucun paiement
      'converted',  -- convertie en token au moment de la finalisation
      'cancelled'   -- annulee avant finalisation
    );
  END IF;
END $$;

-- ============================================================
-- 2. Table collective_workspaces
-- ============================================================
CREATE TABLE IF NOT EXISTS collective_workspaces (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tokens (hash stocke, brut envoye au client uniquement a la creation)
  public_token_hash     TEXT UNIQUE NOT NULL,   -- pour les contributeurs (lien partageable)
  creator_token_hash    TEXT UNIQUE NOT NULL,   -- pour le createur (controle privilegie)

  -- Evenement (libre, juste pour l'humain)
  event_name            TEXT NOT NULL,          -- ex: "Mariage Fatima septembre"
  event_note            TEXT,                   -- texte libre

  -- Createur
  creator_name          TEXT NOT NULL,
  creator_phone         TEXT,
  creator_email         TEXT,
  creator_user_id       UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Destinataire (qui recoit la commande au final)
  recipient_name        TEXT,
  recipient_phone       TEXT,
  relais_id             UUID REFERENCES relais(id) ON DELETE SET NULL,

  -- Etat
  status                collective_workspace_status NOT NULL DEFAULT 'conception',

  -- Lien vers commande creee (nullable, peuple uniquement si 100% securise)
  order_id              UUID REFERENCES orders(id) ON DELETE SET NULL,

  -- Timestamps
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_at          TIMESTAMPTZ,
  archived_at           TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  metadata              JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_cw_public_token_hash  ON collective_workspaces(public_token_hash);
CREATE INDEX IF NOT EXISTS idx_cw_creator_token_hash ON collective_workspaces(creator_token_hash);
CREATE INDEX IF NOT EXISTS idx_cw_status             ON collective_workspaces(status);
CREATE INDEX IF NOT EXISTS idx_cw_creator_user       ON collective_workspaces(creator_user_id) WHERE creator_user_id IS NOT NULL;

-- ============================================================
-- 3. Table collective_workspace_items
-- ============================================================
CREATE TABLE IF NOT EXISTS collective_workspace_items (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             UUID NOT NULL REFERENCES collective_workspaces(id) ON DELETE CASCADE,
  product_id               UUID REFERENCES products(id) ON DELETE SET NULL,
  quantity                 INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),

  -- Snapshots figes au moment de la finalisation (prix, nom, image)
  -- En phase conception : valeurs courantes (peuvent evoluer)
  product_name_snapshot    TEXT,
  product_image_snapshot   TEXT,
  price_snapshot_kmf       INTEGER CHECK (price_snapshot_kmf IS NULL OR price_snapshot_kmf >= 0),

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cwi_workspace ON collective_workspace_items(workspace_id);

-- ============================================================
-- 4. Table collective_workspace_contributions
--    Intentions libres pendant la phase conception.
-- ============================================================
CREATE TABLE IF NOT EXISTS collective_workspace_contributions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID NOT NULL REFERENCES collective_workspaces(id) ON DELETE CASCADE,
  contributor_name      TEXT NOT NULL,
  contributor_phone     TEXT,
  contributor_email     TEXT,
  intended_amount_kmf   INTEGER NOT NULL CHECK (intended_amount_kmf > 0),
  status                collective_contribution_status NOT NULL DEFAULT 'intention',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cwc_workspace ON collective_workspace_contributions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_cwc_status    ON collective_workspace_contributions(status);

-- ============================================================
-- 5. Table collective_payment_sessions
--    Sessions courtes verrouillees (24-72h).
-- ============================================================
CREATE TABLE IF NOT EXISTS collective_payment_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES collective_workspaces(id) ON DELETE RESTRICT,

  total_to_pay_kmf    INTEGER NOT NULL CHECK (total_to_pay_kmf > 0),
  amount_secured_kmf  INTEGER NOT NULL DEFAULT 0 CHECK (amount_secured_kmf >= 0),

  -- Snapshots figes
  fx_rate_snapshot    NUMERIC(12,6),  -- taux EUR/KMF utilise
  fees_snapshot_kmf   INTEGER DEFAULT 0,

  status              collective_session_status NOT NULL DEFAULT 'open',
  expires_at          TIMESTAMPTZ NOT NULL,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cps_workspace  ON collective_payment_sessions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_cps_status     ON collective_payment_sessions(status);
CREATE INDEX IF NOT EXISTS idx_cps_expires_at ON collective_payment_sessions(expires_at)
  WHERE status IN ('open', 'ready_to_capture');

-- ============================================================
-- 6. Table collective_payment_tokens
--    Un token = un contributeur = un PaymentIntent Stripe.
-- ============================================================
CREATE TABLE IF NOT EXISTS collective_payment_tokens (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id                 UUID NOT NULL REFERENCES collective_payment_sessions(id) ON DELETE CASCADE,

  token_hash                 TEXT UNIQUE NOT NULL,    -- hash du token brut (envoye au contributeur)

  -- Contributeur (snapshot figeable)
  contributor_name           TEXT NOT NULL,
  contributor_phone          TEXT,
  contributor_email          TEXT,

  amount_kmf                 INTEGER NOT NULL CHECK (amount_kmf > 0),

  -- Stripe
  stripe_payment_intent_id   TEXT UNIQUE,
  stripe_checkout_session_id TEXT UNIQUE,

  status                     collective_token_status NOT NULL DEFAULT 'active',

  expires_at                 TIMESTAMPTZ NOT NULL,
  authorized_at              TIMESTAMPTZ,
  paid_at                    TIMESTAMPTZ,
  cancelled_at               TIMESTAMPTZ,

  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cpt_session     ON collective_payment_tokens(session_id);
CREATE INDEX IF NOT EXISTS idx_cpt_token_hash  ON collective_payment_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_cpt_status      ON collective_payment_tokens(status);
CREATE INDEX IF NOT EXISTS idx_cpt_pi_id       ON collective_payment_tokens(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;

-- ============================================================
-- 7. Table collective_workspace_events (audit leger)
-- ============================================================
CREATE TABLE IF NOT EXISTS collective_workspace_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES collective_workspaces(id) ON DELETE CASCADE,
  event_type          TEXT NOT NULL,            -- workspace_created, item_added, contribution_added, etc.
  actor_type          TEXT,                     -- 'creator' | 'contributor' | 'system' | 'admin'
  actor_identifier    TEXT,                     -- email/phone/user_id selon le contexte
  payload             JSONB DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cwe_workspace ON collective_workspace_events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_cwe_type      ON collective_workspace_events(event_type);
CREATE INDEX IF NOT EXISTS idx_cwe_created   ON collective_workspace_events(created_at);

-- ============================================================
-- 8. Table stripe_events_processed (idempotence webhook)
--    Technique : empeche le double-traitement d'un evenement Stripe.
-- ============================================================
CREATE TABLE IF NOT EXISTS stripe_events_processed (
  stripe_event_id  TEXT PRIMARY KEY,
  event_type       TEXT NOT NULL,
  processed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload_summary  JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_sep_processed_at ON stripe_events_processed(processed_at);

-- ============================================================
-- 9. Trigger updated_at sur collective_workspaces
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'collective_set_updated_at') THEN
    CREATE FUNCTION collective_set_updated_at() RETURNS trigger AS $body$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $body$ LANGUAGE plpgsql;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_cw_updated_at ON collective_workspaces;
CREATE TRIGGER trg_cw_updated_at BEFORE UPDATE ON collective_workspaces
  FOR EACH ROW EXECUTE FUNCTION collective_set_updated_at();

DROP TRIGGER IF EXISTS trg_cwi_updated_at ON collective_workspace_items;
CREATE TRIGGER trg_cwi_updated_at BEFORE UPDATE ON collective_workspace_items
  FOR EACH ROW EXECUTE FUNCTION collective_set_updated_at();

DROP TRIGGER IF EXISTS trg_cwc_updated_at ON collective_workspace_contributions;
CREATE TRIGGER trg_cwc_updated_at BEFORE UPDATE ON collective_workspace_contributions
  FOR EACH ROW EXECUTE FUNCTION collective_set_updated_at();

-- ============================================================
-- FIN MIGRATION 048
-- ============================================================
