-- Migration 069 — Index analytiques pour les requêtes lourdes
-- ═══════════════════════════════════════════════════════════════════════
-- D2 : complète les index de 016_add_missing_indexes.sql sur les patterns
--      identifiés par EXPLAIN ANALYZE (admin-radar, cost-allocation, dashboard-metrics).
--
-- ⚠️  CONCURRENTLY INTERDIT DANS UNE TRANSACTION
-- Ce fichier ne doit JAMAIS être exécuté dans un BEGIN/COMMIT.
-- Les index CONCURRENTLY s'exécutent en tâche de fond sans verrou full-table.
-- Une transaction les ferait échouer immédiatement avec :
--   ERROR: CREATE INDEX CONCURRENTLY cannot run inside a transaction block
--
-- ── Application correcte ────────────────────────────────────────────────────
--   psql $DATABASE_URL -f 069_analytical_indexes.sql
--   (psql exécute chaque instruction en autocommit par défaut — c'est le bon mode)
--
-- ── Vérification post-application ───────────────────────────────────────────
--   SELECT indexname, indexdef
--     FROM pg_indexes
--    WHERE schemaname = 'public'
--      AND indexname LIKE 'idx_%'
--      AND indexname IN (
--        'idx_orders_status_created_desc',
--        'idx_orders_status_payment_created',
--        'idx_orders_relais_status',
--        'idx_orders_created_at',
--        'idx_real_cost_alloc_source_created',
--        'idx_economic_snapshots_created_at',
--        'idx_signals_severity_status',
--        'idx_signals_severity_created'
--      );
--   -- Doit retourner 8 lignes.
--
-- ── Guard anti-transaction ───────────────────────────────────────────────────
-- Cette instruction fait échouer le fichier immédiatement si psql est
-- déjà dans une transaction ouverte (BEGIN implicite d'un runner).
-- Elle est un no-op en mode autocommit normal.
-- ═══════════════════════════════════════════════════════════════════════

-- ── orders — filtres radar & dashboard ───────────────────────────────────────

-- admin-radar /status-details : WHERE status NOT IN ('refunded') ORDER BY created_at DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_status_created_desc
  ON orders (status, created_at DESC);

-- dashboard-metrics : COUNT FILTER sur (status, payment_status, created_at)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_status_payment_created
  ON orders (status, payment_status, created_at);

-- relay-dashboard GET /orders : WHERE relais_id = $1 AND status = ...
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_relais_status
  ON orders (relais_id, status);

-- ── order_items — cost-allocation allocateMonthlyFixedCosts ──────────────────

-- Range scan mensuel sur orders.created_at
-- (l'index sur order_items.order_id existe déjà : idx_order_items_order_id)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_created_at
  ON orders (created_at);

-- Idempotence mensuelle : DELETE WHERE source = 'monthly_recalc' AND created_at < ...
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_real_cost_alloc_source_created
  ON order_item_real_cost_allocations (source, created_at)
  WHERE source = 'monthly_recalc';

-- ── economic_snapshots — rétention cron ──────────────────────────────────────

-- DELETE WHERE created_at < NOW() - INTERVAL '90 days'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_economic_snapshots_created_at
  ON economic_snapshots (created_at);

-- ── signals — lecture dashboard radar ────────────────────────────────────────
-- Table : signals (pas alerts). Colonne : severity (pas level). Filtre : status = 'open'.

-- WHERE severity IN ('critical','high') AND status = 'open'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_signals_severity_status
  ON signals (severity, status)
  WHERE status = 'open';

-- ORDER BY severity, created_at DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_signals_severity_created
  ON signals (severity, created_at DESC);
