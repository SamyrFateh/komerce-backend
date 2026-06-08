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

-- FRESH-108 : Déduplication préventive des doublons existants avant création de l'index.
-- Conserve la ligne avec le plus petit id pour chaque (supplier_name, supplier_product_id).
-- Sans cette étape, la migration échoue si des doublons existent déjà en production.
DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT supplier_name, supplier_product_id
    FROM sourcing_candidates
    WHERE supplier_product_id IS NOT NULL
    GROUP BY supplier_name, supplier_product_id
    HAVING COUNT(*) > 1
  ) dupes;

  IF dup_count > 0 THEN
    RAISE NOTICE 'FRESH-108 : % groupes en doublon détectés — déduplication en cours...', dup_count;
    DELETE FROM sourcing_candidates
    WHERE id IN (
      SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY supplier_name, supplier_product_id
                 ORDER BY id ASC
               ) AS rn
        FROM sourcing_candidates
        WHERE supplier_product_id IS NOT NULL
      ) ranked
      WHERE rn > 1
    );
    RAISE NOTICE 'FRESH-108 : déduplication terminée.';
  ELSE
    RAISE NOTICE 'FRESH-108 : aucun doublon détecté — index applicable directement.';
  END IF;
END $$;


CREATE UNIQUE INDEX IF NOT EXISTS uniq_sc_supplier_ref
  ON sourcing_candidates (supplier_name, supplier_product_id)
  WHERE supplier_product_id IS NOT NULL;

DO $$
BEGIN
  RAISE NOTICE 'Migration 042 OK : index unique partiel uniq_sc_supplier_ref créé.';
END $$;
