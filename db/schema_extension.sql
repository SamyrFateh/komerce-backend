-- ============================================================
-- KOMERCE — Extension schéma v2
-- À exécuter APRÈS schema.sql
-- Ajoute les tables pour M10 (paniers), M11 (cérémonie), M12 (litiges)
-- ============================================================

-- ── TENUES DE CÉRÉMONIE — M11 ────────────────────────────────

CREATE TABLE IF NOT EXISTS ceremony_fabrics (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                TEXT        NOT NULL,
  material            TEXT,
  price_per_meter_aed NUMERIC(8,2) NOT NULL,
  colors              TEXT[]      DEFAULT '{}',
  occasions           TEXT[]      DEFAULT '{}',
  image_url           TEXT,
  is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ceremony_models (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                TEXT        NOT NULL,
  making_cost_aed     NUMERIC(8,2) NOT NULL,
  fabric_meters       NUMERIC(5,2) NOT NULL,
  occasions           TEXT[]      DEFAULT '{}',
  sizes_available     TEXT[]      DEFAULT '{S,M,L,XL,XXL}',
  image_url           TEXT,
  is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lignes de commande cérémonie (tailles détaillées)
CREATE TABLE IF NOT EXISTS ceremony_order_items (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id            UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  fabric_id           UUID        REFERENCES ceremony_fabrics(id),
  model_id            UUID        REFERENCES ceremony_models(id),
  size                TEXT        NOT NULL,  -- S | M | L | XL | XXL
  quantity            INTEGER     NOT NULL DEFAULT 1,
  prix_par_tenue_kmf  INTEGER     NOT NULL,
  fabric_name         TEXT,                  -- snapshot nom tissu
  model_name          TEXT,                  -- snapshot nom modèle
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- LITIGES → voir schema.sql (table disputes avec CHECK constraints + ON DELETE CASCADE)
-- Définition dupliquée supprimée (Sprint 1 — P5)

-- ── INDEX extension ──────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ceremony_order_items_order ON ceremony_order_items(order_id);
-- disputes indexes déjà dans schema.sql

-- ── DONNÉES INITIALES CÉRÉMONIE ──────────────────────────────

INSERT INTO ceremony_fabrics (name, material, price_per_meter_aed, colors, occasions)
VALUES
  ('Bazin blanc brillant',  'Bazin',    28, '{blanc,ivoire}',           '{mariage,bapteme}'),
  ('Bazin coloré imprimé',  'Bazin',    25, '{bleu,vert,rouge}',        '{fete,ceremonie}'),
  ('Soie imprimée Deira',   'Soie',     45, '{bleu nuit,bordeaux,or}',  '{mariage}'),
  ('Wax africain 6 yards',  'Wax coton',18, '{multicolore}',            '{quotidien,fete}'),
  ('Dentelle brodée fine',  'Dentelle', 55, '{blanc,creme,beige}',      '{mariage}'),
  ('Voile léger cérémonie', 'Voile',    22, '{blanc,rose poudre}',      '{ceremonie}')
ON CONFLICT DO NOTHING;

INSERT INTO ceremony_models (name, making_cost_aed, fabric_meters, occasions)
VALUES
  ('Robe longue cérémonie', 35, 3.5, '{mariage,ceremonie}'),
  ('Ensemble 2 pièces',     40, 4.0, '{mariage,fete}'),
  ('Boubou traditionnel',   30, 3.0, '{ceremonie,quotidien}'),
  ('Caftan élégant',        38, 3.2, '{mariage}'),
  ('Abaya simple',          25, 2.5, '{quotidien,ceremonie}')
ON CONFLICT DO NOTHING;
