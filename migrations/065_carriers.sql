-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 065 — Table carriers (transporteurs)
--
-- Contexte : table absente du schéma Railway prod.
-- Utilisée par :
--   · GET  /api/carriers          → liste pour sélection à l'expédition (hub)
--   · POST /api/carriers          → créer un transporteur (admin)
--   · PATCH /api/carriers/:id     → modifier (admin)
--   · DELETE /api/carriers/:id    → soft-delete (admin)
--
-- Idempotente : CREATE TABLE IF NOT EXISTS + INSERT ... ON CONFLICT DO NOTHING
-- Rollback    : DROP TABLE IF EXISTS carriers;
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS carriers (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(100) NOT NULL,
  type             VARCHAR(50)  DEFAULT 'maritime',  -- maritime | aerien | terrestre | mixte
  contact_name     VARCHAR(100),
  contact_phone    VARCHAR(30),
  contact_email    VARCHAR(100),
  avg_transit_days INTEGER,                           -- délai moyen en jours
  cost_per_kg_kmf  NUMERIC(10,2),                    -- coût indicatif KMF/kg
  is_active        BOOLEAN      DEFAULT TRUE,
  notes            TEXT,
  created_at       TIMESTAMPTZ  DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_carriers_active
  ON carriers(is_active)
  WHERE is_active = TRUE;

-- ── Seed transporteurs de base ───────────────────────────────────────────────
-- Transporteurs typiques sur la route Dubai → Comores.
-- Adapter selon les partenaires réels avant la mise en prod.
-- ON CONFLICT DO NOTHING = idempotent, re-exécutable sans risque.

INSERT INTO carriers (name, type, avg_transit_days, notes) VALUES
  ('Conteneur maritime standard', 'maritime',  45, 'Transit Dubai → Moroni via Djibouti'),
  ('Fret aérien express',         'aerien',     5, 'Dubai → Moroni IADN, coût élevé'),
  ('Transporteur mixte Comores',  'mixte',      21, 'Combiné mer/air selon volume')
ON CONFLICT DO NOTHING;

COMMIT;
