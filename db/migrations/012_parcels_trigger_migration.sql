-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 012 — Refonte Parcel-Centric · Phase 3 : Migration Trigger
--
-- OBJECTIF : Désactiver le trigger legacy trg_scan_sync_status et faire de
--            parcelSync.js (via computeOrderStatus) la SOURCE DE VÉRITÉ unique
--            pour le statut des commandes.
--
-- CHANGEMENTS :
--   1. Désactiver le trigger trg_scan_sync_status sur scans
--   2. Copier computed_status → status pour les commandes avec parcels (réconciliation)
--   3. Supprimer la colonne computed_status (plus nécessaire)
--   4. Index scans.parcel_id filtré (préparation requêtes futures)
--
-- PRÉ-REQUIS :
--   - Phase 2 (migration 011) déployée et fonctionnelle
--   - parcelSync.js v2 (Phase 3) déployé AVANT cette migration
--     (parcelSync écrit maintenant dans orders.status + order_status_history)
--
-- ROLLBACK :
--   1. ALTER TABLE orders ADD COLUMN computed_status TEXT;
--   2. CREATE TRIGGER trg_scan_sync_status ...
--   3. Reverter parcelSync.js à la version Phase 2
--
-- IMPACT : MODÉRÉ. Le trigger est désactivé, parcelSync.js prend le relai.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Vérification de cohérence (advisory) ────────────────────────────────
-- Avant de couper le trigger, on vérifie que computed_status et status sont
-- cohérents pour les commandes ayant des parcels.
-- Cette requête est en lecture seule — elle ne bloque pas la migration.

DO $$
DECLARE
  drift_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO drift_count
  FROM orders o
  WHERE o.computed_status IS NOT NULL
    AND o.computed_status != o.status::text;

  IF drift_count > 0 THEN
    RAISE NOTICE '[PHASE 3] ⚠️ % commandes avec drift status vs computed_status — réconciliation en cours', drift_count;
  ELSE
    RAISE NOTICE '[PHASE 3] ✅ Aucun drift détecté — status et computed_status cohérents';
  END IF;
END $$;


-- ── 2. Réconciliation : computed_status → status ───────────────────────────
-- Pour les commandes où computed_status diffère de status,
-- on fait confiance à computed_status (calculé depuis les parcels = source de vérité).

UPDATE orders
SET status = computed_status::order_status,
    updated_at = NOW()
WHERE computed_status IS NOT NULL
  AND computed_status != status::text
  AND computed_status IN (
    SELECT unnest(enum_range(NULL::order_status))::text
  );


-- ── 3. Désactiver le trigger legacy ────────────────────────────────────────
-- On DISABLE plutôt que DROP pour permettre un rollback rapide si besoin.
-- Pour réactiver : ALTER TABLE scans ENABLE TRIGGER trg_scan_sync_status;

ALTER TABLE scans DISABLE TRIGGER trg_scan_sync_status;

-- Note : la fonction sync_order_status_from_scan() est conservée pour rollback.
-- Elle sera supprimée en Phase 4 (nettoyage).


-- ── 4. Supprimer la colonne computed_status ────────────────────────────────
-- Plus nécessaire : parcelSync.js écrit maintenant directement dans orders.status.
-- On garde la colonne en commentaire pour Phase 4 cleanup plutôt que la supprimer
-- immédiatement — ceinture et bretelles.

-- ALTER TABLE orders DROP COLUMN IF EXISTS computed_status;
-- → Reporté à Phase 4 pour rollback facile. On la marque comme deprecated :

COMMENT ON COLUMN orders.computed_status IS
  'DEPRECATED Phase 3 — Ne plus utiliser. parcelSync.js écrit maintenant dans orders.status directement. Sera supprimée en Phase 4.';


-- ── 5. Index scans.parcel_id filtré ────────────────────────────────────────
-- Prépare les requêtes Phase 4/5 (historique par parcel, analytics)

CREATE INDEX IF NOT EXISTS idx_scans_parcel_id_active
  ON scans(parcel_id) WHERE parcel_id IS NOT NULL;


COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIN Migration 012 — Phase 3 : Migration Trigger
--
-- Le trigger trg_scan_sync_status est désactivé.
-- parcelSync.js est maintenant la SOURCE DE VÉRITÉ pour orders.status.
-- Prochaine étape : Phase 4 — Nettoyage (DROP computed_status, DROP function)
-- ═══════════════════════════════════════════════════════════════════════════════
