-- ============================================================
-- Migration 035c: Correctif suppliers_stats — bon ENUM order_status
-- Date: avril 2026
--
-- CONTEXTE: Les migrations 035 et 035b utilisaient 'expired' qui
-- n'existe pas dans l'ENUM order_status (valeurs réelles :
-- confirmed, ordered, preparation, shipped, available, collected,
-- cancelled, refunded — cf db/migrations/004_fix_order_status_enum.sql).
--
-- Cette migration recrée la vue suppliers_stats avec les bons statuts.
-- ============================================================

CREATE OR REPLACE VIEW suppliers_stats AS
SELECT
  p.id AS partner_id,
  p.name,
  p.partner_type,
  -- Commandes liées (pour personnalisé / sourcing)
  COALESCE((
    SELECT COUNT(*)
      FROM orders o
     WHERE o.supplier_id = p.id
       AND o.status NOT IN ('cancelled', 'refunded')
  ), 0) AS orders_count_30d,
  COALESCE((
    SELECT SUM(o.total_kmf)
      FROM orders o
     WHERE o.supplier_id = p.id
       AND o.status NOT IN ('cancelled', 'refunded')
       AND o.created_at >= NOW() - INTERVAL '30 days'
  ), 0) AS orders_revenue_30d_kmf,
  COALESCE((
    SELECT AVG(o.margin_real_pct)
      FROM orders o
     WHERE o.supplier_id = p.id
       AND o.margin_real_pct IS NOT NULL
       AND o.created_at >= NOW() - INTERVAL '90 days'
  ), 0) AS avg_margin_pct_90d,
  -- Envois douane liés (pour logistique)
  COALESCE((
    SELECT COUNT(*)
      FROM customs_shipments cs
     WHERE cs.supplier_id = p.id
       AND cs.is_active = TRUE
  ), 0) AS shipments_count,
  COALESCE((
    SELECT AVG(cs.effective_rate_pct)
      FROM customs_shipments cs
     WHERE cs.supplier_id = p.id
       AND cs.is_active = TRUE
       AND cs.shipment_date >= CURRENT_DATE - INTERVAL '90 days'
  ), 0) AS avg_customs_rate_90d
FROM partners p
WHERE p.is_active = TRUE;

-- ============================================================
-- FIN migration 035c
-- ============================================================
