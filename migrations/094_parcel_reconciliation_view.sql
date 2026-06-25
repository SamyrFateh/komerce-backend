-- ============================================================================
--  094_parcel_reconciliation_view.sql
--  Réconciliation colis ⇄ commandes — VUE EN LECTURE SEULE
--
--  Principe : pas de job, pas de cron. On interroge cette vue à la demande
--  (ou on branche son count() sur le dashboard Opérationnel). Chaque ligne
--  avec cardinality(issues) > 0 est un point à traiter.
--
--  Pré-requis : parcel_events (migration 078) est désormais alimenté à chaque
--  transition par utils/parcelSync.js. Aucun nouveau DDL ici.
-- ============================================================================

CREATE OR REPLACE VIEW v_parcel_reconciliation AS
WITH last_event AS (
  SELECT DISTINCT ON (parcel_id)
         parcel_id, event_type, created_at
  FROM parcel_events
  ORDER BY parcel_id, created_at DESC
),
coverage AS (
  SELECT oi.order_id,
         COUNT(oi.id)                                                    AS items_total,
         COUNT(pi.order_item_id) FILTER (WHERE pa.status <> 'cancelled') AS items_packed
  FROM order_items oi
  LEFT JOIN parcel_items pi ON pi.order_item_id = oi.id
  LEFT JOIN parcels      pa ON pa.id = pi.parcel_id
  GROUP BY oi.order_id
)
SELECT
  p.id                       AS parcel_id,
  p.reference                AS parcel_ref,
  o.reference                AS order_ref,
  p.status                   AS parcel_status,
  o.status                   AS order_status,
  le.event_type              AS last_event,
  le.created_at              AS last_event_at,
  cov.items_packed,
  cov.items_total,
  (p.seal_code IS NOT NULL)  AS has_seal,
  ARRAY_REMOVE(ARRAY[
    -- 1) La projection (parcels.status) diverge du journal d'événements
    CASE WHEN le.event_type IS NOT NULL AND le.event_type <> p.status
         THEN 'projection_vs_event_drift' END,
    -- 2) Colis expédié (ou plus loin) mais articles manquants
    CASE WHEN p.status IN ('shipped','in_transit','arrived','available','collected')
          AND cov.items_packed < cov.items_total
         THEN 'shipped_incomplete' END,
    -- 3) La commande a avancé mais le colis est resté en draft
    CASE WHEN p.status = 'draft'
          AND o.status IN ('shipped','in_transit','delivered','available','collected')
         THEN 'order_ahead_of_parcel' END,
    -- 4) Colis sans scellé (visibilité, pas blocage — décision métier à trancher)
    CASE WHEN p.seal_code IS NULL
         THEN 'no_seal' END,
    -- 5) Colis avancé mais aucun événement tracé (zone aveugle)
    CASE WHEN p.status <> 'draft' AND le.event_type IS NULL
         THEN 'no_event_trace' END
  ], NULL) AS issues
FROM parcels p
JOIN orders o           ON o.id = p.order_id
LEFT JOIN last_event le ON le.parcel_id = p.id
LEFT JOIN coverage cov  ON cov.order_id = p.order_id
WHERE p.status <> 'cancelled';

-- Liste de travail :
--   SELECT parcel_ref, order_ref, parcel_status, order_status, issues
--   FROM v_parcel_reconciliation WHERE cardinality(issues) > 0
--   ORDER BY last_event_at NULLS FIRST;
--
-- Compteur dashboard :
--   SELECT count(*) FROM v_parcel_reconciliation WHERE cardinality(issues) > 0;
