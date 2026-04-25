-- ============================================================
-- Migration 035b: Correctif partners.partner_type
-- Date: avril 2026
--
-- CONTEXTE: La migration 035 a échoué avec
--   "ERROR: column partner_type does not exist"
-- Ce qui signifie que ta table `partners` en prod a une structure
-- différente de celle attendue. Probablement la colonne s'appelle
-- 'type' (sans préfixe) au lieu de 'partner_type'.
--
-- Cette migration normalise le schéma SANS perdre de données.
-- ============================================================

-- ── 1. Diagnostic & normalisation de la colonne type ────────────────────────
-- Cas A : la colonne 'type' existe → on la renomme en 'partner_type'
-- Cas B : ni 'type' ni 'partner_type' → on ajoute 'partner_type'
-- Cas C : 'partner_type' existe déjà → rien à faire

DO $$
BEGIN
  -- Cas A : renommer 'type' → 'partner_type'
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'partners' AND column_name = 'type'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'partners' AND column_name = 'partner_type'
  ) THEN
    ALTER TABLE partners RENAME COLUMN type TO partner_type;
    RAISE NOTICE 'Colonne partners.type renommée en partner_type';
  END IF;

  -- Cas B : ajouter partner_type si absente
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'partners' AND column_name = 'partner_type'
  ) THEN
    ALTER TABLE partners ADD COLUMN partner_type TEXT NOT NULL DEFAULT 'relais';
    RAISE NOTICE 'Colonne partner_type ajoutée avec défaut relais';
  END IF;
END $$;

-- ── 2. Vérifier que les autres colonnes essentielles existent ───────────────
-- (au cas où ta table prod a une structure encore différente)

ALTER TABLE partners ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS contact_phone TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS island TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS zone TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS commission_kmf INTEGER DEFAULT 0;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE partners ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ── 3. Re-jouer la création des index qui ont échoué dans la 035 ───────────
CREATE INDEX IF NOT EXISTS idx_partners_type
  ON partners(partner_type) WHERE is_active = TRUE;

-- ── 4. Re-créer la vue suppliers_stats qui avait échoué ────────────────────
CREATE OR REPLACE VIEW suppliers_stats AS
SELECT
  p.id AS partner_id,
  p.name,
  p.partner_type,
  COALESCE((
    SELECT COUNT(*)
      FROM orders o
     WHERE o.supplier_id = p.id
       AND o.status NOT IN ('cancelled', 'expired')
  ), 0) AS orders_count_30d,
  COALESCE((
    SELECT SUM(o.total_kmf)
      FROM orders o
     WHERE o.supplier_id = p.id
       AND o.status NOT IN ('cancelled', 'expired')
       AND o.created_at >= NOW() - INTERVAL '30 days'
  ), 0) AS orders_revenue_30d_kmf,
  COALESCE((
    SELECT AVG(o.margin_real_pct)
      FROM orders o
     WHERE o.supplier_id = p.id
       AND o.margin_real_pct IS NOT NULL
       AND o.created_at >= NOW() - INTERVAL '90 days'
  ), 0) AS avg_margin_pct_90d,
  COALESCE((
    SELECT COUNT(*)
      FROM customs_shipments cs
     WHERE cs.supplier_id = p.id
       AND cs.is_active = TRUE
  ), 0) AS shipments_count,
  COALESCE((
    SELECT AVG(cs.effective_rate_pct)
      FROM customs_shipments cs
     WHERE cs.supplier_id = p.id
       AND cs.is_active = TRUE
       AND cs.shipment_date >= CURRENT_DATE - INTERVAL '90 days'
  ), 0) AS avg_customs_rate_90d
FROM partners p
WHERE p.is_active = TRUE;

-- ── 5. Vérification finale ──────────────────────────────────────────────────
-- Si tu veux voir le résultat :
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'partners' ORDER BY ordinal_position;

-- ============================================================
-- FIN migration 035b
-- ============================================================
