-- 088_sourcing_standalone_fixes.sql
-- Corrections individuelles hors lot — findings F-03, F-05, F-06
-- Source : docs/_work/SOURCING_DB_AUDIT.md
--
-- Risque faible (pas d'impact financier, contrairement à C5/087) :
--   F-03 : products/partners.partner_type — CHECK DB optionnel
--   F-05 : sourcing_candidates — index composite manquant
--   F-06 : products.sourcing_rail — CHECK DB optionnel
--
-- ⚠️ Pré-requis avant exécution : lancer `npm run sourcing:audit` et
-- confirmer que les checks S-04 (rail invalide) et S-05 (partner_type
-- inconnu) ne remontent AUCUNE violation. Si des violations existent,
-- les CHECK ci-dessous échoueront à la création — corriger les données
-- d'abord, ou retirer les deux blocs CHECK de cette migration et ne
-- garder que l'index (F-05), qui est sans risque dans tous les cas.

BEGIN;

-- ── F-05 : index composite manquant sur sourcing_candidates ────────────────
-- Couvre les patterns de requête fréquents de l'analyse sourcing :
-- filtrage par (state, import_id) et (state, supplier_name).
CREATE INDEX IF NOT EXISTS idx_sc_state_import
  ON sourcing_candidates (state, import_id);

CREATE INDEX IF NOT EXISTS idx_sc_state_supplier
  ON sourcing_candidates (state, supplier_name);

-- ── F-06 : products.sourcing_rail — CHECK DB ────────────────────────────────
-- Doit rester synchronisé avec VALID_RAILS dans sourcing-mutations.js
-- et audit-sourcing.js. NULL reste autorisé (rail pas encore assigné).
-- Idempotent : ne fait rien si déjà posé (évite un ROLLBACK si une exécution
-- précédente a partiellement appliqué cette migration).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_products_sourcing_rail'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT chk_products_sourcing_rail
      CHECK (sourcing_rail IS NULL OR sourcing_rail IN ('A', 'B', 'C', 'D'));
  END IF;
END $$;

-- ── F-03 : partners.partner_type — CHECK DB ─────────────────────────────────
-- Doit rester synchronisé avec la liste dans audit-sourcing.js (check S-05).
-- partner_type est NOT NULL en base, donc pas de cas NULL à gérer ici.
-- Idempotent, même logique que ci-dessus.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_partners_partner_type'
  ) THEN
    ALTER TABLE partners
      ADD CONSTRAINT chk_partners_partner_type
      CHECK (partner_type IN (
        'relais_simple', 'relais_showroom', 'partenaire_avance',
        'atelier_couture', 'artisan_retouche', 'franchise_s5'
      ));
  END IF;
END $$;

COMMIT;

-- ── Note évolutivité ────────────────────────────────────────────────────────
-- Si un nouveau partner_type ou rail doit être ajouté plus tard, il faudra
-- modifier CE CHECK, ET la liste dans sourcing-mutations.js / audit-sourcing.js,
-- dans la même migration/PR — sinon la DB bloquera des insertions valides.
