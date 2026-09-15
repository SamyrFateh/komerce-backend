-- audit-f1-market-integrity.sql
-- F1 — Market Integrity : audit live READ-ONLY, à exécuter tel quel sur la
-- vraie base avant toute activation de la migration 229 (F1-B).
--
-- Garantie : ce script ne peut muter aucune donnée. BEGIN TRANSACTION
-- READ ONLY refuse toute écriture au niveau session Postgres (pas
-- seulement une convention de script) ; ROLLBACK explicite en clôture,
-- même si aucune écriture n'a été tentée.
--
-- Usage :
--   psql "$DATABASE_URL" -f audit-f1-market-integrity.sql
--
-- Sortie attendue : deux jeux de résultats.
--   1. Résumé agrégé (une ligne) — voir grille de lecture en bas de fichier.
--   2. Jusqu'à 100 lignes de drill-down sur les commandes anormales
--      (relais orphelin OU market_id manquant OU mismatch order/relais).

BEGIN TRANSACTION READ ONLY;

-- ─────────────────────────────────────────────────────────────────────
-- 1. RÉSUMÉ AGRÉGÉ
-- ─────────────────────────────────────────────────────────────────────
-- Aucune commande ne sort du dénominateur : le LEFT JOIN garde toute ligne
-- orders même si relais_id est NULL ou pointe vers un relais inexistant.

SELECT
  COUNT(*) AS total_orders,

  COUNT(*) FILTER (
    WHERE o.relais_id IS NULL
  ) AS orders_without_relais_id,

  COUNT(*) FILTER (
    WHERE o.relais_id IS NOT NULL
      AND r.id IS NULL
  ) AS orders_with_orphan_relais_reference,

  COUNT(*) FILTER (
    WHERE o.market_id IS NULL
  ) AS orders_without_market_id,

  COUNT(*) FILTER (
    WHERE r.id IS NOT NULL
      AND o.market_id IS NOT NULL
      AND o.market_id IS DISTINCT FROM r.market_id
  ) AS orders_market_relais_mismatch,

  COUNT(*) FILTER (
    WHERE r.id IS NOT NULL
      AND o.market_id = r.market_id
  ) AS orders_consistent

FROM orders o
LEFT JOIN relais r ON r.id = o.relais_id;

-- ─────────────────────────────────────────────────────────────────────
-- 2. DRILL-DOWN SUR LES ANOMALIES (max 100 lignes)
-- ─────────────────────────────────────────────────────────────────────
-- Toute commande qui n'est PAS "consistent" au sens du résumé ci-dessus :
-- relais_id NULL, relais orphelin, market_id NULL, ou mismatch.

SELECT
  o.id                AS order_id,
  o.reference          AS order_reference,
  o.relais_id          AS order_relais_id,
  o.market_id          AS order_market_id,
  r.id                 AS resolved_relais_id,
  r.market_id          AS relais_market_id,
  o.created_at         AS order_created_at,
  CASE
    WHEN o.relais_id IS NULL THEN 'NO_RELAIS_ID'
    WHEN r.id IS NULL THEN 'ORPHAN_RELAIS_REFERENCE'
    WHEN o.market_id IS NULL THEN 'NO_MARKET_ID'
    WHEN o.market_id IS DISTINCT FROM r.market_id THEN 'MARKET_RELAIS_MISMATCH'
    ELSE 'CONSISTENT'
  END AS anomaly_kind
FROM orders o
LEFT JOIN relais r ON r.id = o.relais_id
WHERE
  o.relais_id IS NULL
  OR r.id IS NULL
  OR o.market_id IS NULL
  OR o.market_id IS DISTINCT FROM r.market_id
ORDER BY o.created_at DESC
LIMIT 100;

ROLLBACK;

-- ─────────────────────────────────────────────────────────────────────
-- GRILLE DE LECTURE
-- ─────────────────────────────────────────────────────────────────────
-- orders_without_relais_id > 0
--   → schéma contredit db/schema.sql (relais_id NOT NULL). Si non-zéro,
--     STOP avant migration : incohérence majeure, remonter avant tout code.
--
-- orders_with_orphan_relais_reference > 0
--   → commande référence un relais supprimé/inexistant. F1.2/F1.3 ne
--     peuvent rien garantir sur ces lignes tant qu'elles ne sont pas
--     résolues (elles ne bloquent PAS les futurs INSERT/UPDATE, mais leur
--     existence signale une donnée orpheline à traiter en admin-repair).
--
-- orders_without_market_id > 0
--   → schéma contredit db/schema.sql (market_id NOT NULL depuis migration
--     138). Si non-zéro, STOP : la garantie NOT NULL a été contournée
--     quelque part (migration partielle, contrainte désactivée en admin).
--
-- orders_market_relais_mismatch > 0
--   → LE cas que F1 existe pour prévenir. Chaque ligne du drill-down avec
--     anomaly_kind = MARKET_RELAIS_MISMATCH doit produire, avant toute
--     activation de F1-B :
--       affected rows, examples, probable cause IF PROVABLE,
--       accountable owner, consulted domains, decision_due_at, decision
--     Ne PAS corriger automatiquement (pas de UPDATE orders SET market_id
--     = relais.market_id) : la valeur historiquement correcte ne peut pas
--     être devinée (voir doctrine F1, § RÈGLE ABSOLUE SUR LES DONNÉES
--     HISTORIQUES).
--
-- Condition de passage F1 DATA PREFLIGHT :
--   orders_without_relais_id = 0
--   AND orders_with_orphan_relais_reference = 0
--   AND orders_without_market_id = 0
--   AND orders_market_relais_mismatch = 0
-- Tant que cette conjonction n'est pas vraie : F1 = PENDING LIVE DATA PREFLIGHT.
