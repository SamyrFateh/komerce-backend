-- ============================================================
-- Migration 035: Partners Enrichment & Linking
-- Date: avril 2026
--
-- OBJECTIF MÉTIER:
--   Unifier la gestion des "fournisseurs" (au sens large) en élargissant
--   la table `partners` existante pour couvrir 3 nouveaux cas :
--     - 'sourcing'      : fournisseurs Dubai/Chine (stock standard)
--     - 'personnalise'  : artisans pour commandes sur-mesure (mariage, cérémonie)
--     - 'logistique'    : transitaires, transporteurs
--   En plus des types existants 'relais' et 'agent_hub'.
--
--   Ajoute aussi les liens FK :
--     - customs_shipments.supplier_id → partners.id (transitaire normalisé)
--     - orders.supplier_id            → partners.id (commande personnalisée assignée)
--
-- CONTEXTE TECHNIQUE:
--   La table partners existait déjà via scripts/fix-schema.js (CREATE TABLE
--   IF NOT EXISTS). Cette migration ajoute les colonnes métier manquantes
--   et les FK utiles, sans casser l'existant.
-- ============================================================

-- ── Garantir l'existence de la table (idempotent) ────────────────────────────
CREATE TABLE IF NOT EXISTS partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  partner_type TEXT NOT NULL DEFAULT 'relais',
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  address TEXT,
  island TEXT,
  zone TEXT,
  commission_kmf INTEGER DEFAULT 0,
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Nouvelles colonnes métier ───────────────────────────────────────────────

-- Pays/origine (ex: 'AE' pour UAE, 'CN' pour Chine, 'KM' pour Comores, 'FR')
ALTER TABLE partners ADD COLUMN IF NOT EXISTS country_code TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS country_label TEXT;

-- Devise de facturation par défaut (AED, USD, EUR, KMF, CNY)
ALTER TABLE partners ADD COLUMN IF NOT EXISTS currency TEXT;

-- Délai moyen de livraison en jours (sourcing & personnalisé)
ALTER TABLE partners ADD COLUMN IF NOT EXISTS lead_time_days INTEGER;

-- Conditions de paiement (texte libre : "30j fin de mois", "Acompte 30% + solde livraison", etc.)
ALTER TABLE partners ADD COLUMN IF NOT EXISTS payment_terms TEXT;

-- Catégories de produits proposés (sourcing & personnalisé)
-- Tableau : ex {phones, electromenager} ou {robes_mariage, dentelles}
ALTER TABLE partners ADD COLUMN IF NOT EXISTS product_categories TEXT[];

-- Lien WhatsApp direct (très utile pour le quotidien)
ALTER TABLE partners ADD COLUMN IF NOT EXISTS whatsapp_url TEXT;

-- URL site web / catalogue
ALTER TABLE partners ADD COLUMN IF NOT EXISTS website_url TEXT;

-- Pour logistique : tarifs habituels (texte libre)
ALTER TABLE partners ADD COLUMN IF NOT EXISTS pricing_notes TEXT;

-- Rating qualitatif 1-5 (nullable, à remplir au fur et à mesure)
ALTER TABLE partners ADD COLUMN IF NOT EXISTS rating SMALLINT
  CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5));

-- ── Élargir le check sur partner_type pour inclure les nouveaux types ───────
-- Note : on ne pose pas de CHECK strict en BDD pour rester souple. La validation
-- se fait dans le validator Joi côté API (validators/index.js).

-- ── Index utiles ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_partners_type        ON partners(partner_type) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_partners_country     ON partners(country_code) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_partners_active      ON partners(is_active);

-- ── FK customs_shipments.supplier_id ─────────────────────────────────────────
-- Permet de normaliser le transitaire (au lieu du texte libre transitaire_name)
ALTER TABLE customs_shipments
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES partners(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customs_shipments_supplier
  ON customs_shipments(supplier_id) WHERE supplier_id IS NOT NULL;

-- ── FK orders.supplier_id ───────────────────────────────────────────────────
-- Pour les commandes personnalisées (mariage, cérémonie sur-mesure) :
-- on assigne un partner partner_type='personnalise' à la commande pour suivre
-- qui produit l'article et calculer les stats par artisan.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES partners(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_supplier
  ON orders(supplier_id) WHERE supplier_id IS NOT NULL;

-- ── Trigger updated_at (idempotent) ─────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_partners_updated') THEN
    CREATE TRIGGER trg_partners_updated
      BEFORE UPDATE ON partners
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ── Vue suppliers_stats : KPI par fournisseur ───────────────────────────────
-- Agrège les commandes liées et les envois douane pour afficher les stats
-- dans la vue Suppliers (nb commandes, CA, marge moyenne).
CREATE OR REPLACE VIEW suppliers_stats AS
SELECT
  p.id AS partner_id,
  p.name,
  p.partner_type,
  -- Commandes liées (pour personnalisé)
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
  -- Envois douane liés (pour logistique)
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

-- ============================================================
-- FIN migration 035
-- ============================================================
