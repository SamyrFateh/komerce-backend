'use strict';

/**
 * KOMERCE — Couverture SKU + rattrapage PDC-8 (scripts/check-sku-coverage.js)
 * =============================================================================
 * Mode historique : mesure, pour chaque produit actif, s'il est prêt à basculer
 * sur `inventory_model = 'SKU'`.
 *
 * Mode PDC-8 one-shot : rejoue de façon contrôlée la promotion des contrats V2
 * déjà importés avant le câblage de `promoteCatalog()` dans le chemin d'import.
 * Le dry-run reste la valeur par défaut et la bascule inventory_model exige un
 * consentement séparé `--switch-ready`.
 *
 * Couverture :
 *   node scripts/check-sku-coverage.js
 *   node scripts/check-sku-coverage.js --json
 *   node scripts/check-sku-coverage.js --strict
 *
 * Backfill PDC-8 :
 *   node scripts/check-sku-coverage.js --backfill
 *   node scripts/check-sku-coverage.js --backfill --product-id <uuid>
 *   node scripts/check-sku-coverage.js --backfill --apply
 *   node scripts/check-sku-coverage.js --backfill --apply --switch-ready
 *   node scripts/check-sku-coverage.js --backfill --apply --switch-ready --product-id <uuid>
 *
 * Sécurité du backfill :
 *   - actifs uniquement par défaut (`--include-inactive` pour élargir) ;
 *   - validation V2 avant écriture ;
 *   - transaction indépendante par produit ;
 *   - promotion idempotente via `promoteCatalog()` ;
 *   - `has_variants` synchronisé depuis les axes explicites du contrat V2 ;
 *   - bascule SKU seulement si produit actif + readiness OK + au moins un SKU
 *     actif avec stock > 0.
 */

require('dotenv').config();
const db = require('../db');
const { auditProductSkuReadiness } = require('../services/product-admin-service');
const { promoteCatalog, validateForPromotion } = require('../services/catalog-promotion');

const JSON_MODE = process.argv.includes('--json');
const STRICT_MODE = process.argv.includes('--strict');
const BACKFILL_MODE = process.argv.includes('--backfill');
const DEFAULT_BACKFILL_LIMIT = 100;
const MAX_BACKFILL_LIMIT = 500;

/**
 * Agrège les résultats d'audit par produit en un résumé de couverture.
 * Fonction pure (aucun I/O) — testable unitairement sans DB.
 */
function computeSummary(results) {
  const total = results.length;
  const alreadySku = results.filter(r => r.already_sku).length;
  const readyNotYet = results.filter(r => !r.already_sku && r.ready).length;
  const notReady = results.filter(r => !r.already_sku && !r.ready);
  const covered = alreadySku + readyNotYet;
  const coveragePct = total === 0 ? 100 : Math.round((covered / total) * 1000) / 10;

  return {
    total_active_products: total,
    already_sku: alreadySku,
    ready_not_switched: readyNotYet,
    not_ready: notReady.length,
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
      product_id: product.id,
      product_name: product.name,
      has_variants: product.has_variants,
      already_sku: !!audit.already_sku,
      ready: !!audit.ready,
      reasons: audit.reasons || [],
    });
  }
  return results;
}

function readArgValue(argv, name) {
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

function parseBackfillArgs(argv = process.argv.slice(2)) {
  const apply = argv.includes('--apply');
  const switchReady = argv.includes('--switch-ready');
  const includeInactive = argv.includes('--include-inactive');
  const productId = readArgValue(argv, '--product-id');
  const rawLimit = readArgValue(argv, '--limit');
  const limit = rawLimit == null ? DEFAULT_BACKFILL_LIMIT : Number(rawLimit);

  if (switchReady && !apply) {
    throw new Error('--switch-ready exige --apply : aucune bascule inventory_model en dry-run');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BACKFILL_LIMIT) {
    throw new Error(`--limit doit être un entier entre 1 et ${MAX_BACKFILL_LIMIT}`);
  }
  if (productId === '') throw new Error('--product-id ne peut pas être vide');

  return { apply, switchReady, includeInactive, productId: productId || null, limit };
}

function inspectBackfillCandidate(row) {
  const contract = row?.normalized_source_contract || null;
  const base = {
    candidate_id: row?.candidate_id || null,
    product_id: row?.product_id || null,
    product_name: row?.product_name || row?.catalog_product_name || null,
    is_active: !!row?.is_active,
    inventory_model: row?.inventory_model || null,
    eligible: false,
    reason: null,
    axes: 0,
    sellable_units: 0,
    source_units_with_positive_stock: 0,
  };

  if (!contract) return { ...base, reason: 'normalized_source_contract absent' };
  if (String(contract.schema_version) !== '2') {
    return { ...base, reason: `schema_version ${JSON.stringify(contract.schema_version)} != "2"` };
  }
  if (!Array.isArray(contract.sellable_units) || contract.sellable_units.length === 0) {
    return { ...base, reason: 'sellable_units absent ou vide' };
  }

  try {
    validateForPromotion(contract);
  } catch (error) {
    return { ...base, reason: error.message };
  }

  const axes = Array.isArray(contract.option_axes) ? contract.option_axes.length : 0;
  const positive = contract.sellable_units.filter((unit) => Number(unit?.stock_available) > 0).length;
  return {
    ...base,
    eligible: true,
    axes,
    sellable_units: contract.sellable_units.length,
    source_units_with_positive_stock: positive,
  };
}

async function fetchBackfillCandidates(q, options) {
  const { rows } = await q.query(
    `WITH latest_candidate AS (
       SELECT DISTINCT ON (sc.product_id)
              sc.id AS candidate_id,
              sc.product_id,
              sc.product_name,
              sc.normalized_source_contract,
              sc.updated_at AS candidate_updated_at,
              p.name AS catalog_product_name,
              p.is_active,
              p.inventory_model,
              p.has_variants
         FROM sourcing_candidates sc
         JOIN products p ON p.id = sc.product_id
        WHERE sc.state = 'imported_to_catalog'
          AND sc.product_id IS NOT NULL
          AND sc.normalized_source_contract IS NOT NULL
        ORDER BY sc.product_id, sc.updated_at DESC, sc.id DESC
     )
     SELECT *
       FROM latest_candidate
      WHERE ($1::boolean = TRUE OR is_active = TRUE)
        AND ($2::text IS NULL OR product_id::text = $2)
      ORDER BY is_active DESC, candidate_updated_at DESC
      LIMIT $3`,
    [options.includeInactive, options.productId, options.limit]
  );
  return rows;
}

async function backfillOneCandidate(rootDb, row, options) {
  const client = await rootDb.getClient();
  try {
    await client.query('BEGIN');

    const { rows: [locked] } = await client.query(
      `SELECT sc.id AS candidate_id,
              sc.product_id,
              sc.product_name,
              sc.normalized_source_contract,
              p.name AS catalog_product_name,
              p.is_active,
              p.inventory_model,
              p.has_variants
         FROM sourcing_candidates sc
         JOIN products p ON p.id = sc.product_id
        WHERE sc.id = $1
          AND sc.product_id = $2
          AND sc.state = 'imported_to_catalog'
        FOR UPDATE OF sc, p`,
      [row.candidate_id, row.product_id]
    );

    if (!locked) {
      await client.query('ROLLBACK');
      return { ...inspectBackfillCandidate(row), status: 'skipped', reason: 'candidat ou produit introuvable au verrouillage' };
    }

    const inspection = inspectBackfillCandidate(locked);
    if (!inspection.eligible) {
      await client.query('ROLLBACK');
      return { ...inspection, status: 'skipped' };
    }

    const hasVariants = inspection.axes > 0;
    await client.query(
      `UPDATE products
          SET has_variants = $2,
              updated_at = NOW()
        WHERE id = $1
          AND has_variants IS DISTINCT FROM $2`,
      [locked.product_id, hasVariants]
    );

    const promotion = await promoteCatalog(client, {
      productId: locked.product_id,
      normalizedSourceContract: locked.normalized_source_contract,
    });

    const readiness = await auditProductSkuReadiness(client, locked.product_id);
    const { rows: [{ count: positiveSkuCount }] } = await client.query(
      `SELECT COUNT(*)::int AS count
         FROM product_skus
        WHERE product_id = $1
          AND is_active = TRUE
          AND stock > 0`,
      [locked.product_id]
    );

    let switched = false;
    let switchReason = 'non demandé';
    if (options.switchReady) {
      if (!locked.is_active) {
        switchReason = 'produit inactif';
      } else if (!readiness.ready) {
        switchReason = `readiness refusé : ${(readiness.reasons || []).join(' ; ') || 'raison inconnue'}`;
      } else if (Number(positiveSkuCount) < 1) {
        switchReason = 'aucun SKU actif avec stock positif';
      } else {
        const result = await client.query(
          `UPDATE products
              SET inventory_model = 'SKU',
                  updated_at = NOW()
            WHERE id = $1
              AND inventory_model <> 'SKU'
            RETURNING id`,
          [locked.product_id]
        );
        switched = result.rowCount > 0;
        switchReason = switched ? 'basculé vers SKU' : 'déjà en SKU';
      }
    }

    await client.query('COMMIT');
    return {
      ...inspection,
      status: 'applied',
      has_variants_synced_to: hasVariants,
      promotion,
      readiness,
      positive_active_skus: Number(positiveSkuCount),
      switched,
      switch_reason: switchReason,
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* rollback best effort */ }
    return { ...inspectBackfillCandidate(row), status: 'failed', error: error.message };
  } finally {
    client.release();
  }
}

function printBackfillItem(item) {
  const icon = item.eligible ? '✓' : '–';
  console.log(`${icon} ${item.product_name || item.product_id} (${item.product_id})`);
  console.log(`  actif=${item.is_active} inventory_model=${item.inventory_model} axes=${item.axes} sellable_units=${item.sellable_units} stock_source_positif=${item.source_units_with_positive_stock}`);
  if (item.reason) console.log(`  raison=${item.reason}`);
  if (item.status) console.log(`  status=${item.status}`);
  if (item.switch_reason) console.log(`  switch=${item.switch_reason}`);
  if (item.error) console.log(`  erreur=${item.error}`);
}

async function runBackfill(options = parseBackfillArgs()) {
  const candidates = await fetchBackfillCandidates(db, options);
  const inspections = candidates.map(inspectBackfillCandidate);
  const eligible = inspections.filter((item) => item.eligible);

  console.log('── PDC-8 — Backfill promotion catalogue ─────────────────────────────');
  console.log(`Mode              : ${options.apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Bascule SKU       : ${options.switchReady ? 'OUI (readiness + stock positif requis)' : 'NON'}`);
  console.log(`Produits inactifs : ${options.includeInactive ? 'INCLUS' : 'EXCLUS'}`);
  console.log(`Candidats trouvés : ${candidates.length}`);
  console.log(`Éligibles V2      : ${eligible.length}`);
  console.log('');

  if (!options.apply) {
    inspections.forEach(printBackfillItem);
    console.log('');
    console.log('DRY-RUN : aucune écriture. Relance avec --backfill --apply pour promouvoir.');
    console.log('Ajoute --switch-ready pour autoriser explicitement la bascule inventory_model=SKU des produits réellement prêts.');
    return { mode: 'dry-run', candidates: inspections };
  }

  const results = [];
  for (const row of candidates) {
    const result = await backfillOneCandidate(db, row, options);
    results.push(result);
    printBackfillItem(result);
  }

  const applied = results.filter((item) => item.status === 'applied').length;
  const switched = results.filter((item) => item.switched).length;
  const failed = results.filter((item) => item.status === 'failed').length;
  console.log('');
  console.log(`Bilan : ${applied} promu(s) · ${switched} basculé(s) SKU · ${failed} échec(s)`);
  if (failed > 0) process.exitCode = 1;
  return { mode: 'apply', results, applied, switched, failed };
}

async function runCoverage() {
  const results = await fetchAuditResults();
  const summary = computeSummary(results);
  const notReady = summary.not_ready_products;
  const total = summary.total_active_products;
  const alreadySku = summary.already_sku;
  const readyNotYet = summary.ready_not_switched;
  const coveragePct = summary.coverage_pct;

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
      console.log('   les produits ci-dessus n\'ont pas déclaré leur(s) SKU.');
    }
  }

  if (STRICT_MODE && !summary.fallback_removable) process.exitCode = 1;
  return { summary, products: results };
}

async function run() {
  if (BACKFILL_MODE) return runBackfill(parseBackfillArgs());
  return runCoverage();
}

module.exports = {
  DEFAULT_BACKFILL_LIMIT,
  MAX_BACKFILL_LIMIT,
  computeSummary,
  fetchAuditResults,
  parseBackfillArgs,
  inspectBackfillCandidate,
  fetchBackfillCandidates,
  backfillOneCandidate,
  runBackfill,
  runCoverage,
  run,
};

if (require.main === module) {
  run()
    .catch(err => {
      console.error(`❌ check-sku-coverage a échoué : ${err.message}`);
      process.exitCode = 1;
    })
    .finally(() => {
      if (db.pool && typeof db.pool.end === 'function') db.pool.end().catch(() => {});
    });
}
