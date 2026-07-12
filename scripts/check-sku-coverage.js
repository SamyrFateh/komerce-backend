'use strict';

/**
 * KOMERCE — Couverture SKU (scripts/check-sku-coverage.js)
 * =============================================================================
 * Lot 5 (cf. docs/specs/DECISION_MODELE_STOCK_SKU.md §E.5, §F) : mesure, pour
 * chaque produit actif, s'il est prêt à basculer sur `inventory_model = 'SKU'`.
 * Réutilise `auditProductSkuReadiness()` (services/product-admin-service.js,
 * Lot 1) — même règle de vérité que l'API admin, pas de logique dupliquée.
 *
 * Ce script est PUREMENT OBSERVATIONNEL par défaut : il ne modifie jamais
 * `products.inventory_model` (la bascule reste un acte explicite séparé,
 * produit par produit, via l'écran admin — Lot 1). Il sert à répondre à la
 * question « peut-on retirer le fallback deux-axes ? » avec une mesure,
 * plutôt qu'une date arbitraire (doctrine §E.5).
 *
 * Usage :
 *   node scripts/check-sku-coverage.js              # rapport, exit 0 toujours
 *   node scripts/check-sku-coverage.js --json        # rapport en JSON (CI/scripts)
 *   node scripts/check-sku-coverage.js --strict       # exit 1 si couverture
 *                                                       incomplète — à lancer
 *                                                       uniquement avant de
 *                                                       retirer le fallback
 *                                                       deux-axes (Lot 5 final)
 *
 * Ne bloque PAS la CI par défaut (pas ajouté à npm test / arch:gate) :
 * la bascule est un choix produit par produit, mesurable à la demande.
 */

require('dotenv').config();
const db = require('../db');
const { auditProductSkuReadiness } = require('../services/product-admin-service');

const JSON_MODE   = process.argv.includes('--json');
const STRICT_MODE = process.argv.includes('--strict');

/**
 * Agrège les résultats d'audit par produit en un résumé de couverture.
 * Fonction pure (aucun I/O) — testable unitairement sans DB.
 * @param {Array<{product_id, product_name, has_variants, already_sku, ready, reasons}>} results
 */
function computeSummary(results) {
  const total       = results.length;
  const alreadySku  = results.filter(r => r.already_sku).length;
  const readyNotYet = results.filter(r => !r.already_sku && r.ready).length;
  const notReady    = results.filter(r => !r.already_sku && !r.ready);
  const covered     = alreadySku + readyNotYet; // "couvert" = SKU déjà là, ou prêt à basculer
  const coveragePct = total === 0 ? 100 : Math.round((covered / total) * 1000) / 10;

  return {
    total_active_products: total,
    already_sku:  alreadySku,
    ready_not_switched: readyNotYet,
    not_ready:    notReady.length,
    not_ready_products: notReady,
    coverage_pct: coveragePct,
    fallback_removable: notReady.length === 0,
  };
}

async function fetchAuditResults() {
  const { rows: products } = await db.query(
    `SELECT id, name, has_variants, inventory_model
       FROM products
      WHERE is_active = TRUE
      ORDER BY has_variants DESC, name`
  );

  const results = [];
  for (const product of products) {
    const audit = await auditProductSkuReadiness(db, product.id);
    results.push({
      product_id:   product.id,
      product_name: product.name,
      has_variants: product.has_variants,
      already_sku:  !!audit.already_sku,
      ready:        !!audit.ready,
      reasons:      audit.reasons || [],
    });
  }
  return results;
}

async function run() {
  const results = await fetchAuditResults();
  const summary = computeSummary(results);
  const notReady = summary.not_ready_products;

  if (JSON_MODE) {
    const { not_ready_products, ...summaryOut } = summary;
    console.log(JSON.stringify({ summary: summaryOut, products: results }, null, 2));
  } else {
    console.log('── KOMERCE — Couverture SKU (Lot 5) ─────────────────────────────────────');
    console.log(`Produits actifs analysés : ${total}`);
    console.log(`  Déjà en mode SKU       : ${alreadySku}`);
    console.log(`  Prêts, pas basculés    : ${readyNotYet}`);
    console.log(`  Non prêts              : ${notReady.length}`);
    console.log(`Couverture               : ${coveragePct}%`);
    console.log('');

    if (notReady.length > 0) {
      console.log('Produits non prêts :');
      for (const r of notReady) {
        console.log(`  ❌ ${r.product_name} (${r.product_id})`);
        for (const reason of r.reasons) console.log(`       - ${reason}`);
      }
      console.log('');
    }

    if (summary.fallback_removable) {
      console.log('✅ Tous les produits actifs sont couverts — le fallback deux-axes');
      console.log('   peut être retiré (cf. DECISION_MODELE_STOCK_SKU.md §F, Lot 5 final).');
    } else {
      console.log('⚠️  Couverture incomplète — NE PAS retirer le fallback deux-axes tant que');
      console.log('   les produits ci-dessus n\'ont pas déclaré leur(s) SKU (écran admin, Lot 1).');
    }
  }

  if (STRICT_MODE && !summary.fallback_removable) {
    process.exitCode = 1;
  }
}

module.exports = { computeSummary, fetchAuditResults, run };

if (require.main === module) {
  run()
    .catch(err => {
      console.error('❌ check-sku-coverage a échoué :', err.message);
      process.exitCode = 1;
    })
    .finally(() => {
      if (db.pool && typeof db.pool.end === 'function') db.pool.end().catch(() => {});
    });
}
