-- @migration patch_variants.sql
-- @domain    catalog
-- @purpose   Patch product_variants
-- @added-header 2026-07-01 (audit gouvernance)

-- ══════════════════════════════════════════════════════════════════════
--  patch_variants.sql
--  Correctifs base de données — variantes produit (boutique modal v2)
--  À appliquer sur Railway PostgreSQL
--  Idempotent : peut être rejoué sans risque
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
--  1. NORMALISER stock NULL → 0
--     Le JS fait `opt.stock === 0` pour la rupture.
--     Un NULL passe en stock "disponible" côté frontend.
-- ─────────────────────────────────────────────────────────────────────

-- 1a. Corriger les lignes existantes
UPDATE public.product_variants
SET stock = 0
WHERE stock IS NULL;

-- 1b. Rendre la colonne NOT NULL avec défaut 0 (cohérent avec products.stock)
ALTER TABLE public.product_variants
  ALTER COLUMN stock SET DEFAULT 0,
  ALTER COLUMN stock SET NOT NULL;

-- La contrainte CHECK existante (stock >= 0) est conservée telle quelle.


-- ─────────────────────────────────────────────────────────────────────
--  2. TRIGGER has_variants — sync automatique sur products
--     Si on INSERT/DELETE une variante, has_variants se met à jour
--     tout seul. Plus de désynchronisation possible.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_has_variants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  _product_id uuid;
  _count      integer;
BEGIN
  -- Récupérer le product_id concerné (INSERT/UPDATE = NEW, DELETE = OLD)
  _product_id := COALESCE(NEW.product_id, OLD.product_id);

  SELECT COUNT(*) INTO _count
  FROM public.product_variants
  WHERE product_id = _product_id;

  UPDATE public.products
  SET has_variants = (_count > 0),
      updated_at   = NOW()
  WHERE id = _product_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Supprimer si déjà présent (idempotence) puis recréer
DROP TRIGGER IF EXISTS trg_sync_has_variants ON public.product_variants;

CREATE TRIGGER trg_sync_has_variants
AFTER INSERT OR DELETE OR UPDATE OF product_id
ON public.product_variants
FOR EACH ROW
EXECUTE FUNCTION public.sync_has_variants();

-- 2b. Resync immédiate de tous les produits existants
--     (rattrape les désynchronisations antérieures)
UPDATE public.products p
SET has_variants = (
  SELECT COUNT(*) > 0
  FROM public.product_variants pv
  WHERE pv.product_id = p.id
);


-- ─────────────────────────────────────────────────────────────────────
--  3. GARANTIR l'ORDER BY display_order dans la vue/requête API
--     L'index idx_product_variants_lookup existe déjà sur
--     (product_id, variant_type, display_order) — on l'exploite.
--
--     Ajout d'une VIEW variants_ordered pour que la route API
--     n'ait pas à se souvenir du ORDER BY.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.product_variants_ordered AS
SELECT
  id,
  product_id,
  variant_type,
  variant_value,
  sku,
  COALESCE(stock, 0)      AS stock,   -- sécurité double
  price_kmf,
  image_url,
  display_order,
  created_at,
  updated_at
FROM public.product_variants
ORDER BY product_id, variant_type, display_order ASC, created_at ASC;

COMMENT ON VIEW public.product_variants_ordered IS
  'Variantes triées display_order ASC — utiliser cette vue dans /api/products/:id';


-- ─────────────────────────────────────────────────────────────────────
--  VÉRIFICATION — à lancer après le patch pour contrôle
-- ─────────────────────────────────────────────────────────────────────
--
--  Produits désynchronisés (devrait retourner 0 lignes) :
--
--    SELECT p.id, p.name, p.has_variants, COUNT(pv.id) AS nb_variants
--    FROM products p
--    LEFT JOIN product_variants pv ON pv.product_id = p.id
--    GROUP BY p.id, p.name, p.has_variants
--    HAVING (p.has_variants = true  AND COUNT(pv.id) = 0)
--        OR (p.has_variants = false AND COUNT(pv.id) > 0);
--
--  Variantes sans image_url pour les types couleur (à alimenter) :
--
--    SELECT product_id, variant_type, variant_value
--    FROM product_variants
--    WHERE variant_type ~* 'couleur|color|coloris|teinte'
--      AND image_url IS NULL
--    ORDER BY variant_type, variant_value;
--
-- ─────────────────────────────────────────────────────────────────────

COMMIT;
