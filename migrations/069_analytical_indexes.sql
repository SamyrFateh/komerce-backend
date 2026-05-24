-- Migration 069 — Index analytiques pour les requêtes lourdes
-- D2 : compléter les index de 016_add_missing_indexes.sql sur les patterns
--      identifiés par EXPLAIN ANALYZE (admin-radar, cost-allocation, dashboard-metrics).
--
-- Tous en CONCURRENTLY : pas de verrou full-table en production.
-- À exécuter hors transaction (CONCURRENTLY interdit dans BEGIN/COMMIT).

-- ── orders — filtres radar & dashboard ───────────────────────────────────────

-- admin-radar /status-details : WHERE status NOT IN ('refunded') ORDER BY created_at DESC
-- Couvre les requêtes avec ORDER BY created_at sur commandes actives.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_status_created_desc
  ON orders (status, created_at DESC);

-- dashboard-metrics : agrégats sur (status, payment_status, created_at)
-- Couvre les COUNT FILTER combinant les 3 colonnes.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_status_payment_created
  ON orders (status, payment_status, created_at);

-- orders par relais (relay-dashboard GET /orders — filtre relais_id + status)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_relais_status
  ON orders (relais_id, status);

-- ── order_items — cost-allocation allocateMonthlyFixedCosts ──────────────────

-- WHERE o.created_at >= $monthStart AND o.created_at < $monthEnd
-- + JOIN order_items oi ON oi.order_id = o.id
-- L'index sur order_items.order_id existe déjà (idx_order_items_order_id).
-- On ajoute un index sur orders.created_at seul pour le range scan mensuel.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_created_at
  ON orders (created_at);

-- order_item_real_cost_allocations — DELETE WHERE source + created_at (idempotence mensuelle)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_real_cost_alloc_source_created
  ON order_item_real_cost_allocations (source, created_at)
  WHERE source = 'monthly_recalc';

-- ── economic_snapshots — rétention cron (D1) ─────────────────────────────────

-- DELETE WHERE created_at < NOW() - INTERVAL '90 days'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_economic_snapshots_created_at
  ON economic_snapshots (created_at);

-- ── alerts — lecture dashboard radar (level + source) ────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alerts_level_created
  ON alerts (level, created_at DESC);
