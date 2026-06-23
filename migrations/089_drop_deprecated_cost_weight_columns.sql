-- 089_drop_deprecated_cost_weight_columns.sql
-- Lot C5 — étape finale : suppression des colonnes dépréciées
-- Source : migrations/087_normalize_sourcing_duplicate_columns.sql
--
-- Contexte :
--   Migration 087 (exécutée le 2026-06-23/24) a fait de cost_kmf / weight_kg
--   les colonnes de vérité uniques sur `products` et a annoté
--   cost_price_kmf / weight_g comme DEPRECATED (non droppées à l'époque,
--   par prudence — "N jours de stabilité prod" avant suppression).
--
--   services/sourcing-mutations.js n'écrit plus que cost_kmf/weight_kg
--   depuis 087 (LEGACY_FIELD_MAP). audit-sourcing.js S-02/S-07 (divergence
--   doublon) ont été retirés le 2026-06-24 car la divergence est désormais
--   un état attendu, pas un bug — donc plus aucun garde-fou ne surveille
--   ces deux colonnes. C'est le signal qu'il est temps de les supprimer
--   plutôt que de les laisser pourrir en silence.
--
-- Fenêtre de stabilité retenue : 14 jours après l'exécution de 087
-- (2026-06-24 → 2026-07-08). Choix arbitraire mais documenté ; à ajuster
-- si une raison métier impose plus long avant golive.
--
-- ⚠️ GARDE-FOU DATE — cette migration ÉCHOUE VOLONTAIREMENT si exécutée
-- avant le 2026-07-08. Ne pas retirer ce garde-fou pour "débloquer" plus
-- vite : repousser la date dans CE fichier, avec une raison, si besoin.
--
-- ⚠️ Avant d'exécuter après le 2026-07-08, vérifier manuellement (lecture
-- seule) qu'aucun code n'a recommencé à écrire dans ces colonnes :
--   grep -rn "cost_price_kmf\|weight_g\b" --include="*.js" . | grep -v node_modules | grep -v tests/ | grep -v audit-sourcing.js | grep -v sourcing-mutations.js | grep -v sourcing-analysis.js | grep -v validators/index.js
-- Si cette commande retourne autre chose que startup-migrations.js
-- (création idempotente des colonnes au boot, sans rapport), s'arrêter et
-- comprendre pourquoi avant de dropper.

DO $$
BEGIN
  IF CURRENT_DATE < DATE '2026-07-08' THEN
    RAISE EXCEPTION
      'Migration 089 bloquée par garde-fou date : fenêtre de stabilité C5 (087) pas encore écoulée. Exécutable à partir du 2026-07-08. Aujourd''hui : %', CURRENT_DATE;
  END IF;
END $$;

BEGIN;

ALTER TABLE products DROP COLUMN IF EXISTS cost_price_kmf;
ALTER TABLE products DROP COLUMN IF EXISTS weight_g;

COMMIT;

-- ── Vérification post-migration (lecture seule) ────────────────────────────
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'products' AND column_name IN ('cost_price_kmf', 'weight_g');
-- Doit retourner 0 ligne.
