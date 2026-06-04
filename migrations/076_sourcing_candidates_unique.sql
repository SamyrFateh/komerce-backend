-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 042 — DSC-E1 : Index unique partiel sur sourcing_candidates
--
-- Objectif : rendre l'ingestion idempotente (§5.3 — identité fournisseur).
-- Un re-import du même CSV ne crée plus de doublons.
--
-- Contrainte :
--   Index partiel WHERE supplier_product_id IS NOT NULL
--   → la dédup ne s'applique qu'aux produits identifiés côté fournisseur.
--   → les saisies manuelles (supplier_product_id NULL) restent sans contrainte.
-- ─────────────────────────────────────────────────────────────────────────────

SET client_encoding = 'UTF8';

CREATE UNIQUE INDEX IF NOT EXISTS uniq_sc_supplier_ref
  ON sourcing_candidates (supplier_name, supplier_product_id)
  WHERE supplier_product_id IS NOT NULL;

DO $$
BEGIN
  RAISE NOTICE 'Migration 042 OK : index unique partiel uniq_sc_supplier_ref créé.';
END $$;
