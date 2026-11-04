-- @komerce-arch
-- @domain    purchasing
-- @purpose   Rendre l'ambiguïté de résolution fournisseur impossible : une priorité unique par produit parmi les associations actives non supprimées.
-- @safety    Échoue avec un message clair si des doublons existent déjà (aucune correction silencieuse) ; DDL idempotente.
-- @doctrine  docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md

DO $$
DECLARE
  dup_count integer;
  dup_sample text;
BEGIN
  IF to_regclass('public.ux_product_suppliers_active_priority') IS NULL THEN
    SELECT COUNT(*), string_agg(format('product=%s priority=%s (%s associations)', product_id, priority, n), '; ')
      INTO dup_count, dup_sample
      FROM (
        SELECT product_id, priority, COUNT(*) AS n
          FROM public.product_suppliers
         WHERE is_active = TRUE AND deleted_at IS NULL
         GROUP BY product_id, priority
        HAVING COUNT(*) > 1
         LIMIT 20
      ) d;
    IF dup_count > 0 THEN
      RAISE EXCEPTION 'product_suppliers : % doublon(s) de priorité parmi les associations actives (extrait : %). Corriger les priorités (ou désactiver les associations en trop) puis rejouer ; voir scripts/recette/audit-sku-supplier-link.js.', dup_count, dup_sample;
    END IF;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_product_suppliers_active_priority
  ON public.product_suppliers (product_id, priority)
  WHERE is_active = TRUE AND deleted_at IS NULL;
