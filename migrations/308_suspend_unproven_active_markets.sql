-- 308_suspend_unproven_active_markets.sql
-- Lot 5 (stabilisation multi-pays, arbitrage propriétaire c) — CM et CG sont passés ACTIVE par le backfill
-- de la migration 278 (is_active=true), sans readiness ni preuve de livrabilité. Ils sont ramenés à SUSPENDED :
-- le checkout répond MARKET_SUSPENDED (409, message explicite), rien n'est supprimé, l'état est réversible.
-- Réouverture : POST /api/admin/markets/:code/lifecycle {status:'ACTIVE'}, qui exige la readiness verte
-- (dont l'attestation de livrabilité). Ne touche ni KM (marché de référence) ni aucun autre marché.
-- Data-only, idempotent (ne change que les lignes encore ACTIVE) ; trace dans market_delegation_audit.
-- Rollback : UPDATE markets SET lifecycle_status='ACTIVE' WHERE code IN ('CM','CG') AND lifecycle_status='SUSPENDED';

WITH changed AS (
  UPDATE markets
     SET lifecycle_status = 'SUSPENDED'
   WHERE code IN ('CM', 'CG')
     AND lifecycle_status = 'ACTIVE'
  RETURNING id, code
)
INSERT INTO market_delegation_audit (action, market_id, payload_before, payload_after, correlation_id)
SELECT 'MARKET_LIFECYCLE_CHANGED', c.id,
       jsonb_build_object('lifecycle_status', 'ACTIVE', 'is_active', true),
       jsonb_build_object('lifecycle_status', 'SUSPENDED', 'is_active', true),
       'migration-308-suspend-unproven-active-markets'
  FROM changed c;
