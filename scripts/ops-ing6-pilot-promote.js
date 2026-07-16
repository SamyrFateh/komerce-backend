#!/usr/bin/env node
'use strict';

const db = require('../db');
const scanner = require('../services/supplier-catalog-scanner');
const pricingEngine = require('../services/pricing-engine');
const { promoteCatalog } = require('../services/catalog-promotion');
const { approveProduct } = require('../services/catalog-approval');

const SUPPLIER = 'KOMERCE-TEST-DUMMYJSON';
const SUPPLIER_PRODUCT_ID = 'dummyjson-derived-2';
const EXPECTED_NAME = 'Eyeshadow Palette with Mirror';
const ALLOWED_BATCH_STATUSES = new Set(['COMPLETED', 'COMPLETED_WITH_QUARANTINE']);
const ALLOWED_SOURCING_DECISIONS = new Set(['TEST', 'PRIORITY']);

async function loadCandidate(client = db) {
  const { rows } = await client.query(
    `SELECT sc.*, sci.status AS import_status
       FROM sourcing_candidates sc
       LEFT JOIN supplier_catalog_imports sci ON sci.id = sc.import_id
      WHERE sc.supplier_name = $1
        AND sc.supplier_product_id = $2
      ORDER BY sc.updated_at DESC
      LIMIT 1`,
    [SUPPLIER, SUPPLIER_PRODUCT_ID]
  );
  return rows[0] || null;
}

async function loadProduct(productId) {
  const { rows } = await db.query(
    `SELECT id, name, category, price_kmf, stock, is_active,
            quality_validated, lifecycle_status
       FROM products
      WHERE id = $1`,
    [productId]
  );
  return rows[0] || null;
}

async function verifyProduct(productId, { active }) {
  const row = await loadProduct(productId);
  if (!row) throw new Error(`Produit ${productId} introuvable après promotion`);
  if (row.name !== EXPECTED_NAME) throw new Error(`Produit inattendu : ${row.name}`);

  if (active) {
    if (row.is_active !== true || row.lifecycle_status !== 'active' || row.quality_validated !== true) {
      throw new Error(`Produit non publié selon la doctrine : ${JSON.stringify(row)}`);
    }
  } else if (row.is_active !== false || row.lifecycle_status !== 'candidate') {
    throw new Error(`Produit candidat dans un état inattendu : ${JSON.stringify(row)}`);
  }

  const [media, variants, skus, skuMedia] = await Promise.all([
    db.query('SELECT COUNT(*)::int AS n FROM catalog_media WHERE product_id = $1', [productId]),
    db.query('SELECT COUNT(*)::int AS n FROM product_variants WHERE product_id = $1', [productId]),
    db.query('SELECT COUNT(*)::int AS n FROM product_skus WHERE product_id = $1', [productId]),
    db.query(
      `SELECT COUNT(*)::int AS n
         FROM product_sku_media psm
         JOIN product_skus ps ON ps.id = psm.sku_id
        WHERE ps.product_id = $1`,
      [productId]
    ),
  ]);

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

async function publishProduct(productId) {
  const before = await loadProduct(productId);
  if (!before) throw new Error(`Produit ${productId} introuvable avant publication`);

  if (!before.is_active || before.lifecycle_status !== 'active') {
    const approval = await approveProduct(db, productId, { id: 'ING6_PILOT_AUTOPUBLISH' });
    if (approval.status !== 200) {
      throw new Error(`Publication refusée (${approval.status}) : ${JSON.stringify(approval.body)}`);
    }
  }

  return verifyProduct(productId, { active: true });
}

async function enrichCandidate(candidate, config) {
  const normalized = await scanner.normalizeCandidate(
    {
      supplier_name: candidate.supplier_name,
      supplier_product_id: candidate.supplier_product_id,
      product_name: candidate.product_name,
      supplier_category: candidate.supplier_category,
      purchase_price: candidate.purchase_price,
      currency: candidate.currency,
      image_url: candidate.image_url,
      product_url: candidate.product_url,
      description: candidate.description,
      stock_available: candidate.stock_available,
      min_order_qty: candidate.min_order_qty,
      supplier_delay_days: candidate.supplier_delay_days,
      weight_kg: candidate.weight_kg,
      dimensions: {
        l_cm: candidate.dim_l_cm,
        w_cm: candidate.dim_w_cm,
        h_cm: candidate.dim_h_cm,
      },
    },
    { config }
  );

  if (!normalized.purchase_price_kmf) {
    throw new Error('Le prix fournisseur n’a pas pu être converti en KMF');
  }

  const { rows } = await db.query(
    `UPDATE sourcing_candidates
        SET komerce_category = $1,
            purchase_price_kmf = $2,
            estimated_weight_kg = $3,
            estimated_volume_m3 = $4,
            target_margin_pct = $5,
            data_sources = $6::jsonb,
            confidence = $7
      WHERE id = $8
      RETURNING *`,
    [
      normalized.komerce_category,
      normalized.purchase_price_kmf,
      normalized.estimated_weight_kg,
      normalized.estimated_volume_m3,
      normalized.target_margin_pct,
      JSON.stringify(normalized.data_sources || {}),
      normalized.confidence,
      candidate.id,
    ]
  );

  return { ...rows[0], import_status: candidate.import_status };
}

function assertPromotable(candidate) {
  if (candidate.state === 'quarantined') throw new Error('La palette est en quarantaine — promotion interdite');
  if (candidate.state === 'rejected') throw new Error('La palette est rejetée — promotion interdite');
  if (candidate.import_status && !ALLOWED_BATCH_STATUSES.has(candidate.import_status)) {
    throw new Error(`Batch parent non promouvable : ${candidate.import_status}`);
  }
  if (!candidate.normalized_source_contract || String(candidate.normalized_source_contract.schema_version) !== '2') {
    throw new Error('Contrat V2 absent ou invalide sur le candidat pilote');
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL requis');

  let candidate = await loadCandidate();
  if (!candidate) {
    throw new Error(`Candidat ${SUPPLIER}/${SUPPLIER_PRODUCT_ID} introuvable`);
  }

  if (candidate.state === 'imported_to_catalog' && candidate.product_id) {
    const verification = await publishProduct(candidate.product_id);
    console.log(JSON.stringify({
      ok: true,
      idempotent: true,
      candidate_id: candidate.id,
      ...verification,
    }, null, 2));
    return;
  }

  assertPromotable(candidate);

  const config = await pricingEngine.loadGlobalConfig();
  candidate = await enrichCandidate(candidate, config);

  const scan = await scanner.scanCandidate(candidate, { config });
  if (!ALLOWED_SOURCING_DECISIONS.has(scan.sourcing_decision)) {
    throw new Error(`Décision sourcing non publiable : ${scan.sourcing_decision} — ${scan.reason}`);
  }

  const mergedScan = {
    ...(scan.scan_result || {}),
    sourcing_decision: scan.sourcing_decision,
    reason: scan.reason,
    recommended_action: scan.recommended_action,
  };
  const initialPrice = mergedScan.test_price_kmf
    || mergedScan.recommended_price_kmf
    || mergedScan.minimum_safe_price_kmf
    || 0;
  if (!initialPrice) throw new Error('Aucun prix KMF calculé par le scanner');

  const { rows: scannedRows } = await db.query(
    `UPDATE sourcing_candidates
        SET scan_result = $1::jsonb,
            scan_at = NOW(),
            confidence = $2,
            state = 'scanned'
      WHERE id = $3
      RETURNING *`,
    [JSON.stringify(mergedScan), scan.confidence, candidate.id]
  );
  candidate = { ...scannedRows[0], import_status: candidate.import_status };

  const client = await db.getClient();
  let productId;
  let promotion;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT sc.*, sci.status AS import_status
         FROM sourcing_candidates sc
         LEFT JOIN supplier_catalog_imports sci ON sci.id = sc.import_id
        WHERE sc.id = $1
        FOR UPDATE OF sc`,
      [candidate.id]
    );
    const current = rows[0];
    if (!current) throw new Error('Candidat disparu avant promotion');

    if (current.state === 'imported_to_catalog' && current.product_id) {
      await client.query('ROLLBACK');
      const verification = await publishProduct(current.product_id);
      console.log(JSON.stringify({
        ok: true,
        idempotent: true,
        candidate_id: current.id,
        ...verification,
      }, null, 2));
      return;
    }

    assertPromotable(current);

    const product = await client.query(
      `INSERT INTO products (
         name, category, cost_kmf, price_kmf, stock, weight_kg,
         is_active, lifecycle_status,
         name_source, description_source, source_locale, content_source
       ) VALUES ($1, $2, $3, $4, $5, $6, FALSE, 'candidate', $7, $8, 'en', 'connector_raw')
       RETURNING id`,
      [
        current.product_name,
        current.komerce_category || 'autre',
        current.purchase_price_kmf,
        initialPrice,
        current.stock_available ?? null,
        current.estimated_weight_kg ?? null,
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
       VALUES ($1, 'imported', $2, 'imported_to_catalog', $3::jsonb, NULL)`,
      [
        current.id,
        current.state,
        JSON.stringify({ product_id: productId, price_kmf: initialPrice, operation: 'ING6_PILOT' }),
      ]
    );
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }

  const verification = await publishProduct(productId);
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
    try { await db.pool.end(); } catch (_) {}
    process.exit(process.exitCode || 0);
  });
