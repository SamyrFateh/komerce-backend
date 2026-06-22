'use strict';

/**
 * KOMERCE — CI Database Setup (scripts/ci-migrate.js)
 * ============================================================================
 * Résout le trou de schéma CI identifié le 2026-06-22 :
 *
 *   ci.yml charge db/schema.sql (figé à ~migration 052) puis lance les tests
 *   sans rejouer les migrations 053+. Résultat : colonnes post-052 absentes
 *   (ex. products.product_ref depuis 081) → 500 sur GET /api/products et
 *   toute route touchant shared_carts, orders, parcels, wallet_consumptions…
 *
 * Ce script fait le pont :
 *   1) Crée schema_migrations si absente
 *   2) Baseline les migrations ≤ 052 (structures déjà dans schema.sql)
 *   3) Appelle run-migrations.js pour appliquer les 053+ normalement
 *
 * Usage (ci.yml uniquement — NE PAS utiliser en prod) :
 *   node scripts/ci-migrate.js
 * ============================================================================
 */

const db   = require('../db');
const { run, listMigrationFiles } = require('./run-migrations');

// Migrations couvertes par db/schema.sql.
// À mettre à jour si schema.sql est regénéré depuis prod.
// (Long terme : regénérer schema.sql depuis prod → ce fichier devient trivial.)
const SCHEMA_SQL_BASELINE = new Set([
  '014_parcels_final_cleanup.sql',
  '014_transaction_documents.sql',
  '015_add_backorder_reminder_sent.sql',
  '016_add_missing_indexes.sql',
  '017_hub_safety_constraints.sql',
  '018_schema_reconciliation.sql',
  '019_finance_columns.sql',
  '020_parcel_optimization_schema.sql',
  '021_products_weight_kg.sql',
  '022_parcel_first_refactor.sql',
  '023_invoices.sql',
  '024_notification_log.sql',
  '025_add_subcategory.sql',
  '033_parametres_extension.sql',
  '034_customs_shipments.sql',
  '035_partners_enrichment.sql',
  '036_finance_config_unification.sql',
  '036b_seed_customs_categories.sql',
  '037_pricing_components_risk_provisions.sql',
  '038_price_history.sql',
  '039_pricing_benchmarks.sql',
  '040_pricing_strategies.sql',
  '041_sourcing_candidates.sql',
  '042_sync_products_columns.sql',
  '043_cost_components.sql',
  '044_shared_cart.sql',
  '045_allocation_averages.sql',
  '046_price_history_scenarios.sql',
  '047_calibrage_transitaire_charges.sql',
  '048_collective_workspaces.sql',
  '049_pickup_secret_attempts.sql',
  '050_order_item_cost_imputations.sql',
  '051_order_item_real_cost_allocations.sql',
  '052_contributions_optional_amount.sql',
]);

async function main() {
  const client = await db.getClient();
  try {
    // 1. Table schema_migrations
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        checksum   TEXT,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // 2. Baseline : migrations déjà couvertes par schema.sql
    const all = listMigrationFiles();
    const toBaseline = all.filter(f => SCHEMA_SQL_BASELINE.has(f));
    let baselined = 0;
    for (const f of toBaseline) {
      const { rowCount } = await client.query(
        `INSERT INTO schema_migrations (filename, checksum)
         VALUES ($1, 'ci-schema-sql-baseline')
         ON CONFLICT (filename) DO NOTHING`,
        [f]
      );
      if (rowCount > 0) baselined++;
    }
    console.log(`[ci-migrate] Baseline : ${baselined} migration(s) marquées (couvertes par schema.sql)`);

    // 3. Migrations présentes sur disque mais absentes du Set → avertissement
    const unknown = all.filter(f => !SCHEMA_SQL_BASELINE.has(f));
    if (unknown.length > 0) {
      // Ces fichiers seront appliqués par run() ci-dessous — c'est attendu.
      console.log(`[ci-migrate] À appliquer : ${unknown.length} migration(s) post-schema.sql`);
    }
  } finally {
    client.release();
  }

  // 4. Appliquer les migrations en attente (053+)
  const { applied } = await run();
  console.log(`[ci-migrate] ✅ ${applied.length} migration(s) appliquée(s).`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[ci-migrate] ÉCHEC :', err.message);
    process.exit(1);
  });
