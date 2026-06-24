-- 089_drop_deprecated_cost_weight_columns.sql
-- Lot C5 — étape finale : suppression des colonnes dépréciées
-- Source : migrations/087_normalize_sourcing_duplicate_columns.sql
--
-- ⚠️ INCIDENT 2026-06-24 — RELOCALISÉE dans migrations/scheduled/ :
--   railway.toml exécute `node scripts/migrate.js` comme releaseCommand à
--   chaque déploiement (watchPatterns inclut migrations/**). Ce script
--   appelle run-migrations.js qui scanne migrations/*.sql et exécute tout
--   fichier non encore enregistré dans schema_migrations. Le garde-fou
--   date plus bas (RAISE EXCEPTION si avant 2026-07-08) se déclenchait
--   donc à CHAQUE déploiement (correct en lui-même), et run-migrations.js
--   abandonne tout le run sur le premier échec (`throw`, comportement
--   voulu pour de vraies erreurs SQL) → migrate.js fait process.exit(1)
--   → le releaseCommand Railway échoue → déploiement bloqué. Pas anticipé
--   à la création de ce fichier (session C5, 2026-06-24).
--
--   migrations/scheduled/ n'est PAS scanné par run-migrations.js
--   (fs.readdirSync(MIGRATIONS_DIR) sur migrations/ uniquement, non
--   récursif). Tant que ce fichier reste ici, aucun impact sur les
--   déploiements.
--
--   PROCÉDURE DE RÉACTIVATION (à partir du 2026-07-08, après la
--   vérification manuelle décrite plus bas) :
--     git mv migrations/scheduled/089_drop_deprecated_cost_weight_columns.sql migrations/089_drop_deprecated_cost_weight_columns.sql
--   Le prochain déploiement appliquera la migration normalement (le
--   garde-fou date ci-dessous ne bloquera plus, la date sera passée).
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
-- Garde-fou conservé en défense en profondeur même après la relocalisation
-- ci-dessus (protège contre une réactivation manuelle prématurée).
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
