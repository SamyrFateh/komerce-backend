#!/usr/bin/env node
'use strict';

/**
 * Opération ponctuelle ING-6 : scanner puis promouvoir uniquement
 * dummyjson-derived-2 (Eyeshadow Palette with Mirror).
 *
 * Préconditions :
 * - migrations à jour ;
 * - scripts/pilot-json-import.js déjà exécuté ;
 * - DATABASE_URL injectée par Railway.
 *
 * Le produit reste volontairement INACTIF / lifecycle_status=candidate.
 * Le script est idempotent : un candidat déjà importé est seulement vérifié.
 */

const db = require('../db');
const scanner = require('../services/supplier-catalog-scanner');
const pricingEngine = require('../services/pricing-engine');
const { promoteCatalog } = require('../services/catalog-promotion');

const SUPPLIER = 'DummyJSON';
const SUPPLIER_PRODUCT_ID = 'dummyjson-derived-2';
const EXPECTED_NAME = 'Eyeshadow Palette with Mirror';
const ALLOWED_BATCH_STATUSES = new Set(['COMPLETED', 'COMPLETED_WITH_QUARANTINE']);

async function loadCandidate(client = db) {
  const result = await client.query(
    `SELECT sc.*, sci.status AS import_status
       FROM sourcing_candidates sc
       LEFT JOIN supplier_catalog_imports sci ON sci.id = sc.import_id
      WHERE sc.supplier_name = $1
        AND sc.supplier_product_id = $2
      ORDER BY sc.updated_at DESC
      LIMIT 1`,
    [SUPPLIER, SUPPLIER_PRODUCT_ID]
  );
  return result.rows[0] || null;
}

async function verifyProduct(productId) {
  const product = await db.query(
    `SELECT id, name, category, price_kmf, is_active, lifecycle_status
       FROM products WHERE id = $1`,
    [productId]
  );
  const media = await db.query(
    'SELECT COUNT(*)::int AS n FROM catalog_media WHERE product_id = $1',
    [productId]
  );
  const variants = await db.query(
    'SELECT COUNT(*)::int AS n FROM product_variants WHERE product_id = $1',
    [productId]
  );
  const skus = await db.query(
    'SELECT COUNT(*)::int AS n FROM product_skus WHERE product_id = $1',
    [productId]
  );
  const skuMedia = await db.query(
    `SELECT COUNT(*)::int AS n
       FROM product_sku_media psm
       JOIN product_skus ps ON ps.id = psm.sku_id
      WHERE ps.product_id = $1`,
    [productId]
  );

  const row = product.rows[0];
  if (!row) throw new Error(`Produit ${productId} introuvable après promotion`);
  if (row.name !== EXPECTED_NAME) {
    throw new Error(`Produit inattendu après promotion : ${row.name}`);
  }
  if (row.is_active !== false || row.lifecycle_status !== 'candidate') {
    throw new Error('Le pilote doit rester inactif avec lifecycle_status=candidate');
  }
  if (media.rows[0].n < 1) throw new Error('Aucun média catalogue promu');
  if (skus.rows[0].n < 1) throw new Error('Aucun SKU promu');

  return {
    product: row,
    counts: {
      media: media.rows[0].n,
      variants: variants.rows[0].n,
      skus: skus.rows[0].n,
      sku_media_links: skuMedia.rows[0].n,
    },
  };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL requis');
  }

  let candidate = await loadCandidate();
  if (!candidate) {
    throw new Error(`Candidat ${SUPPLIER}/${SUPPLIER_PRODUCT_ID} introuvable : exécuter d'abord le lot pilote`);
  }

  if (candidate.state === 'imported_to_catalog' && candidate.product_id) {
    const verification = await verifyProduct(candidate.product_id);
    console.log(JSON.stringify({
      ok: true,
      idempotent: true,
      candidate_id: candidate.id,
      ...verification,
    }, null, 2));
    return;
  }

  if (candidate.state === 'quarantined') {
    throw new Error('La palette est en quarantaine — promotion interdite');
  }
  if (candidate.state === 'rejected' || candidate.scan_result?.sourcing_decision === 'EXCLUDED') {
    throw new Error('La palette est rejetée/exclue — promotion interdite');
  }
  if (candidate.import_status && !ALLOWED_BATCH_STATUSES.has(candidate.import_status)) {
    throw new Error(`Batch parent non promouvable : ${candidate.import_status}`);
  }
  if (!candidate.normalized_source_contract || String(candidate.normalized_source_contract.schema_version) !== '2') {
    throw new Error('Contrat V2 absent ou invalide sur le candidat pilote');
  }

  const config = await pricingEngine.loadGlobalConfig();
  const scan = await scanner.scanCandidate(candidate, { config });
  const mergedScan = {
    ...scan.scan_result,
    sourcing_decision: scan.sourcing_decision,
    reason: scan.reason,
    recommended_action: scan.recommended_action,
  };

  const scanned = await db.query(
    `UPDATE sourcing_candidates
        SET scan_result = $1,
            scan_at = NOW(),
            confidence = $2,
            state = 'scanned'
      WHERE id = $3
      RETURNING *`,
    [JSON.stringify(mergedScan), scan.confidence, candidate.id]
  );
  candidate = scanned.rows[0];

  const initialPrice = mergedScan.test_price_kmf
    || mergedScan.recommended_price_kmf
    || mergedScan.minimum_safe_price_kmf
    || 0;
  if (!initialPrice) {
    throw new Error('Aucun prix KMF calculé par le scanner');
  }

  const client = await db.getClient();
  let productId;
  let promotion;
  try {
    await client.query('BEGIN');

    const locked = await client.query(
      `SELECT sc.*, sci.status AS import_status
         FROM sourcing_candidates sc
         LEFT JOIN supplier_catalog_imports sci ON sci.id = sc.import_id
        WHERE sc.id = $1
        FOR UPDATE OF sc`,
      [candidate.id]
    );
    const current = locked.rows[0];
    if (!current) throw new Error('Candidat disparu avant promotion');

    if (current.state === 'imported_to_catalog' && current.product_id) {
      await client.query('ROLLBACK');
      const verification = await verifyProduct(current.product_id);
      console.log(JSON.stringify({
        ok: true,
        idempotent: true,
        candidate_id: current.id,
        ...verification,
      }, null, 2));
      return;
    }
    if (current.state === 'quarantined' || current.state === 'rejected') {
      throw new Error(`État non promouvable après verrouillage : ${current.state}`);
    }
    if (current.import_status && !ALLOWED_BATCH_STATUSES.has(current.import_status)) {
      throw new Error(`Batch parent non promouvable après verrouillage : ${current.import_status}`);
    }

    const product = await client.query(
      `INSERT INTO products (
         name, category, cost_kmf, price_kmf, weight_kg,
         is_active, lifecycle_status,
         name_source, description_source, source_locale, content_source
       ) VALUES ($1, $2, $3, $4, $5, FALSE, 'candidate', $6, $7, 'en', 'connector_raw')
       RETURNING id`,
      [
        current.product_name,
        current.komerce_category || 'autre',
        current.purchase_price_kmf || 0,
        initialPrice,
        current.estimated_weight_kg || null,
        current.product_name,
        current.description || null,
      ]
    );
    productId = product.rows[0].id;

    promotion = await promoteCatalog(client, {
      productId,
      normalizedSourceContract: current.normalized_source_contract,
    });

    await client.query(
      `UPDATE sourcing_candidates
          SET state = 'imported_to_catalog', product_id = $1, updated_by = NULL
        WHERE id = $2`,
      [productId, current.id]
    );
    await client.query(
      `INSERT INTO sourcing_candidate_events
         (candidate_id, event_type, old_state, new_state, changes, triggered_by)
       VALUES ($1, 'imported', $2, 'imported_to_catalog', $3, NULL)`,
      [current.id, current.state, JSON.stringify({ product_id: productId, price_kmf: initialPrice, operation: 'ING6_PILOT' })]
    );

    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }

  const verification = await verifyProduct(productId);
  console.log(JSON.stringify({
    ok: true,
    idempotent: false,
    candidate_id: candidate.id,
    promotion,
    ...verification,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error('Échec pilote ING-6 :', error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await db.end(); } catch (_) {}
  });
