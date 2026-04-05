-- ============================================================
-- KOMERCE — Schéma PostgreSQL MVP
-- Version 1.3 · Mars 2026
-- Inclut : commandes, paiements, logistique, scan chaîne
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- TYPES ÉNUMÉRÉS
-- ============================================================

CREATE TYPE user_role AS ENUM ('client', 'admin', 'agent_relais', 'agent_hub');

CREATE TYPE order_status AS ENUM (
  'draft',        -- panier en cours
  'confirmed',    -- commande confirmée, en attente paiement
  'paid',         -- paiement reçu
  'preparation',  -- [SCAN 1] article préparé au hub
  'shipped',      -- [SCAN 2] expédié (chargé et parti)
  'available',    -- [SCAN 3] reçu au relais → SMS envoyé au destinataire
  'collected',    -- [SCAN 4] récupéré par le destinataire
  'cancelled',
  'refunded'
);

CREATE TYPE payment_mode   AS ENUM ('stripe_eur', 'cash_relais');
CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'failed', 'refunded');
CREATE TYPE basket_type    AS ENUM ('personal', 'shared', 'gift');

-- Étapes de scan sur la chaîne logistique (4 étapes MVP)
CREATE TYPE scan_step AS ENUM (
  'preparation',      -- 1. Article acheté, vérifié, emballé au hub
  'shipped',          -- 2. Expédition maritime confirmée (départ)
  'relais_received',  -- 3. Reçu au point relais → déclenche SMS destinataire
  'collected'         -- 4. Récupéré par le destinataire
);

-- ============================================================
-- UTILISATEURS
-- ============================================================

CREATE TABLE users (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         TEXT        UNIQUE CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone         TEXT        UNIQUE,
  full_name     TEXT        NOT NULL,
  role          user_role   NOT NULL DEFAULT 'client',
  timezone      TEXT,
  currency_pref TEXT        NOT NULL DEFAULT 'KMF',
  password_hash TEXT,                                -- bcrypt hash
  country       CHAR(2)     NOT NULL DEFAULT 'FR',   -- ISO 3166 : 'KM' local, 'FR'/'AE'… diaspora
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- POINTS RELAIS
-- ============================================================

CREATE TABLE relais (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT        NOT NULL,
  agent_name    TEXT        NOT NULL,
  phone         TEXT        NOT NULL,
  address       TEXT        NOT NULL,
  zone          TEXT,
  hours         TEXT,
  island        TEXT        NOT NULL DEFAULT 'Anjouan',
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- PRODUITS
-- ============================================================

CREATE TABLE products (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku           TEXT        UNIQUE,                  -- code produit interne
  name          TEXT        NOT NULL,
  description   TEXT,
  category      TEXT,
  emoji         TEXT,
  price_kmf     INTEGER     NOT NULL,                -- prix de vente livré KMF (source de vérité)
  cost_kmf      INTEGER,                             -- prix d'achat + fret + douane (marge = price - cost)
  promo_pct     INTEGER,
  promo_until   DATE,
  stock         INTEGER     NOT NULL DEFAULT 0,
  weight_kg     NUMERIC(6,2),                        -- poids pour calcul fret
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  is_promo      BOOLEAN     NOT NULL DEFAULT FALSE,
  image_url     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- PANIERS
-- ============================================================

CREATE TABLE baskets (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  code          TEXT        UNIQUE NOT NULL,         -- K-XXXX
  type          basket_type NOT NULL DEFAULT 'personal',
  owner_id      UUID        REFERENCES users(id) ON DELETE SET NULL,
  expires_at    TIMESTAMPTZ,                         -- 7 jours (partagé)
  is_locked     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE basket_items (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  basket_id     UUID        NOT NULL REFERENCES baskets(id) ON DELETE CASCADE,
  product_id    UUID        NOT NULL REFERENCES products(id),
  added_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  quantity      INTEGER     NOT NULL DEFAULT 1,
  price_kmf     INTEGER     NOT NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- DESTINATAIRES
-- ============================================================

CREATE TABLE recipients (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID        REFERENCES users(id) ON DELETE SET NULL,
  full_name     TEXT        NOT NULL,
  phone         TEXT        NOT NULL,
  relais_id     UUID        REFERENCES relais(id),
  is_default    BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- EXPÉDITIONS (containers / lots maritimes)
-- ============================================================

CREATE TABLE shipments (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference       TEXT        UNIQUE NOT NULL,       -- EXP-2026-XX
  origin          TEXT        NOT NULL DEFAULT 'Hub logistique international',
  destination     TEXT        NOT NULL DEFAULT 'Port de Mutsamudu, Anjouan',
  carrier         TEXT,                              -- nom transporteur maritime
  container_ref   TEXT,                              -- référence container
  departed_at     TIMESTAMPTZ,
  eta             TIMESTAMPTZ,                       -- date d'arrivée estimée
  arrived_at      TIMESTAMPTZ,
  customs_cleared_at TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- COMMANDES
-- ============================================================

CREATE TABLE orders (
  id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference           TEXT          UNIQUE NOT NULL,   -- KOM-2026-XXXX
  user_id             UUID          REFERENCES users(id) ON DELETE SET NULL,
  basket_id           UUID          REFERENCES baskets(id) ON DELETE SET NULL,
  recipient_id        UUID          REFERENCES recipients(id),
  relais_id           UUID          NOT NULL REFERENCES relais(id),
  shipment_id         UUID          REFERENCES shipments(id), -- affecté à l'expédition

  -- Montants
  total_kmf           INTEGER       NOT NULL,
  total_eur           NUMERIC(10,2),
  total_aed           NUMERIC(10,2),

  -- Paiement
  payment_mode        payment_mode  NOT NULL,
  payment_status      payment_status NOT NULL DEFAULT 'pending',
  stripe_payment_id   TEXT,
  cash_ref_code       TEXT,                            -- code 6 chiffres affiché client
  cash_qr_data        TEXT,                            -- contenu encodé QR
  cash_paid_at        TIMESTAMPTZ,

  -- Statut
  status              order_status  NOT NULL DEFAULT 'confirmed',
  pickup_code         TEXT,                            -- code retrait destinataire
  shipped_at          TIMESTAMPTZ,
  available_at        TIMESTAMPTZ,
  collected_at        TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  cancel_reason       TEXT,

  -- Coûts réels (pour marge réelle — renseignés après groupage ou à la facturation)
  -- marge_réelle = (price_kmf - cost_kmf) × qty - cost_transport_kmf - cost_douane_kmf
  cost_transport_kmf  INTEGER       NOT NULL DEFAULT 0,  -- part fret maritime allouée
  cost_douane_kmf     INTEGER       NOT NULL DEFAULT 0,  -- part douane/dédouanement

  -- Rappels automatiques Cash relais
  reminder_h12_sent   BOOLEAN       NOT NULL DEFAULT FALSE,
  reminder_h36_sent   BOOLEAN       NOT NULL DEFAULT FALSE,

  notes               TEXT,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE order_items (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id      UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id    UUID        NOT NULL REFERENCES products(id),
  quantity      INTEGER     NOT NULL DEFAULT 1,
  price_kmf     INTEGER     NOT NULL,
  -- Suivi scan individuel par article
  scan_code     TEXT        UNIQUE,                  -- QR/code-barres collé sur le colis
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SCANS — cœur du suivi logistique
-- ============================================================

CREATE TABLE scans (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Ce qui est scanné (ordre ou article individuel)
  order_id      UUID        REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id UUID        REFERENCES order_items(id) ON DELETE CASCADE,

  -- L'étape dans la chaîne
  step          scan_step   NOT NULL,

  -- Qui scanne, où, quand
  scanned_by    UUID        REFERENCES users(id) ON DELETE SET NULL,
  location      TEXT,                                -- "Hub logistique", "Port Mutsamudu", "Relais Mutsamudu Centre"
  device_id     TEXT,                                -- identifiant du scanner/téléphone
  latitude      NUMERIC(9,6),                        -- GPS optionnel
  longitude     NUMERIC(9,6),

  -- Données du scan
  scan_code     TEXT        NOT NULL,                -- valeur du QR/barcode scanné
  notes         TEXT,                                -- anomalie, commentaire agent
  is_anomaly    BOOLEAN     NOT NULL DEFAULT FALSE,  -- colis endommagé, non-conforme

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT scan_target CHECK (
    (order_id IS NOT NULL) OR (order_item_id IS NOT NULL)
  )
);

-- ============================================================
-- HISTORIQUE DES STATUTS COMMANDE
-- ============================================================

CREATE TABLE order_status_history (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id      UUID          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status        order_status  NOT NULL,
  scan_id       UUID          REFERENCES scans(id),  -- scan à l'origine du changement
  changed_by    UUID          REFERENCES users(id) ON DELETE SET NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SMS LOG
-- ============================================================

CREATE TABLE sms_log (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id      UUID        REFERENCES orders(id) ON DELETE SET NULL,
  recipient     TEXT        NOT NULL,
  type          TEXT        NOT NULL,   -- 'confirmation' | 'reminder_h12' | 'available' | 'gift' | 'customs_alert'
  message       TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'pending',
  at_message_id TEXT,
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TAUX DE CHANGE
-- ============================================================

CREATE TABLE exchange_rates (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  eur_kmf       INTEGER     NOT NULL DEFAULT 492,
  aed_kmf       INTEGER     NOT NULL DEFAULT 138,
  valid_from    DATE        NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEX
-- ============================================================

CREATE INDEX idx_orders_reference      ON orders(reference);
CREATE INDEX idx_orders_user           ON orders(user_id);
CREATE INDEX idx_orders_status         ON orders(status);
CREATE INDEX idx_orders_payment_status ON orders(payment_status);
CREATE INDEX idx_orders_cash_ref       ON orders(cash_ref_code);
CREATE INDEX idx_orders_shipment       ON orders(shipment_id);
CREATE INDEX idx_basket_code           ON baskets(code);
CREATE INDEX idx_order_items_order     ON order_items(order_id);
CREATE INDEX idx_order_items_scan_code ON order_items(scan_code);
CREATE INDEX idx_scans_order           ON scans(order_id);
CREATE INDEX idx_scans_step            ON scans(step);
CREATE INDEX idx_scans_code            ON scans(scan_code);
CREATE INDEX idx_scans_anomaly         ON scans(is_anomaly) WHERE is_anomaly = TRUE;
CREATE INDEX idx_shipments_reference   ON shipments(reference);
CREATE INDEX idx_sms_log_order         ON sms_log(order_id);

-- BUG-010 fix: 4 index manquants sur colonnes fréquemment requêtées
CREATE INDEX IF NOT EXISTS idx_orders_relais         ON orders(relais_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product   ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_recipients_user       ON recipients(user_id);
CREATE INDEX IF NOT EXISTS idx_osh_order             ON order_status_history(order_id);

-- Sprint 1 fix (P1): index manquants pour performance requêtes fréquentes
CREATE INDEX IF NOT EXISTS idx_products_category       ON products(category);
CREATE INDEX IF NOT EXISTS idx_scans_scanned_by        ON scans(scanned_by);


-- ============================================================
-- TRIGGERS updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated     BEFORE UPDATE ON users     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_products_updated  BEFORE UPDATE ON products  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_orders_updated    BEFORE UPDATE ON orders    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_shipments_updated BEFORE UPDATE ON shipments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- TRIGGER : scan → mise à jour automatique du statut commande
-- ============================================================

CREATE OR REPLACE FUNCTION sync_order_status_from_scan()
RETURNS TRIGGER AS $$
DECLARE
  v_order_id UUID;
  v_new_status order_status;
BEGIN
  -- Résoudre l'order_id (direct ou via order_item)
  IF NEW.order_id IS NOT NULL THEN
    v_order_id := NEW.order_id;
  ELSE
    SELECT order_id INTO v_order_id FROM order_items WHERE id = NEW.order_item_id;
  END IF;

  -- Correspondance étape scan → statut commande (4 étapes MVP)
  v_new_status := CASE NEW.step
    WHEN 'preparation'    THEN 'preparation'::order_status
    WHEN 'shipped'        THEN 'shipped'::order_status
    WHEN 'relais_received'THEN 'available'::order_status
    WHEN 'collected'      THEN 'collected'::order_status
    ELSE NULL
  END;

  -- Mettre à jour la commande si statut défini
  IF v_new_status IS NOT NULL AND v_order_id IS NOT NULL THEN
    UPDATE orders SET
      status       = v_new_status,
      shipped_at   = CASE WHEN NEW.step = 'shipped'         THEN NOW() ELSE shipped_at   END,
      available_at = CASE WHEN NEW.step = 'relais_received' THEN NOW() ELSE available_at END,
      collected_at = CASE WHEN NEW.step = 'collected'       THEN NOW() ELSE collected_at END
    WHERE id = v_order_id;

    -- Insérer dans l'historique
    INSERT INTO order_status_history (order_id, status, scan_id, changed_by, note)
    VALUES (v_order_id, v_new_status, NEW.id, NEW.scanned_by, NEW.notes);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_scan_sync_status
  AFTER INSERT ON scans
  FOR EACH ROW EXECUTE FUNCTION sync_order_status_from_scan();

-- ============================================================
-- DONNÉES INITIALES
-- ============================================================

INSERT INTO exchange_rates (eur_kmf, aed_kmf, valid_from)
VALUES (492, 138, CURRENT_DATE);

-- ============================================================
-- EXTENSION v6.4 — Tables complémentaires
-- ============================================================

-- TISSUS et MODÈLES → voir schema_extension.sql (ceremony_fabrics, ceremony_models)
-- Tables orphelines fabrics/garment_models supprimées (Sprint 1 — P4)

-- LITIGES & REMBOURSEMENTS (M13)
CREATE TABLE IF NOT EXISTS disputes (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id     UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type         TEXT        NOT NULL,
  level        INTEGER     NOT NULL DEFAULT 1 CHECK (level IN (1,2,3)),
  status       TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open','processing','resolved','closed')),
  description  TEXT,
  photo_urls   TEXT[]      DEFAULT '{}',
  resolution   TEXT,
  refund_kmf   INTEGER     DEFAULT 0,
  refund_eur   NUMERIC(10,2) DEFAULT 0,
  created_by   UUID        REFERENCES users(id),
  resolved_by  UUID        REFERENCES users(id),
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ajouter price_aed sur products si absent (pour moteur pricing v6.4)
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_aed  NUMERIC(10,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS source     TEXT DEFAULT 'S1';
ALTER TABLE products ADD COLUMN IF NOT EXISTS dims_l     NUMERIC(8,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS dims_w     NUMERIC(8,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS dims_h     NUMERIC(8,2);

-- Ajouter country sur users si absent
ALTER TABLE users ADD COLUMN IF NOT EXISTS country CHAR(2) DEFAULT 'KM';

-- Index nouveaux
CREATE INDEX IF NOT EXISTS idx_disputes_order   ON disputes(order_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status  ON disputes(status);

-- Trigger updated_at disputes
CREATE TRIGGER trg_disputes_updated
  BEFORE UPDATE ON disputes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
