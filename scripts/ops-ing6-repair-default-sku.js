#!/usr/bin/env node
'use strict';

const db = require('../db');
const { promoteCatalog } = require('../services/catalog-promotion');

const SUPPLIER = 'KOMERCE-TEST-DUMMYJSON';
const SUPPLIER_PRODUCT_ID = 'dummyjson-derived-2';

function buildRichContract(candidate) {
  const source = candidate.normalized_source_contract;
  if (!source || String(source.schema_version) !== '2') {
    throw new Error('Contrat V2 absent sur le candidat à réparer');
  }

  const media = (source.media || []).map((item, index) => ({
    ...item,
    supplier_media_id: item.supplier_media_id || `${candidate.supplier_product_id}:media:${index + 1}`,
  }));

  const existingUnits = Array.isArray(source.sellable_units) ? source.sellable_units : [];
  const sellableUnits = existingUnits.length > 0 ? existingUnits : [{
    supplier_sku: `${candidate.supplier_product_id}:default`,
    option_values: {},
    purchase_price: Number(candidate.purchase_price),
    stock_available: candidate.stock_available == null ? undefined : Number(candidate.stock_available),
    media_refs: media.map((item) => item.supplier_media_id),
  }];

  return {
    ...source,
    media,
    sellable_units: sellableUnits,
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL requis');

  const { rows } = await db.query(
    `SELECT *
       FROM sourcing_candidates
      WHERE supplier_name = $1
        AND supplier_product_id = $2
      LIMIT 1`,
    [SUPPLIER, SUPPLIER_PRODUCT_ID]
  );
  const candidate = rows[0];
  if (!candidate) throw new Error('Candidat pilote introuvable');
  if (candidate.state !== 'imported_to_catalog' || !candidate.product_id) {
    throw new Error(`Candidat non importé : state=${candidate.state}`);
  }

  const contract = buildRichContract(candidate);
  const client = await db.getClient();
  let promotion;
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE sourcing_candidates
          SET normalized_source_contract = $1::jsonb,
              updated_at = NOW()
        WHERE id = $2`,
      [JSON.stringify(contract), candidate.id]
    );
    promotion = await promoteCatalog(client, {
      productId: candidate.product_id,
      normalizedSourceContract: contract,
    });
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }

  const [skus, links, media] = await Promise.all([
    db.query(
      `SELECT id, supplier_sku, stock, is_active
         FROM product_skus
        WHERE product_id = $1
        ORDER BY supplier_sku`,
      [candidate.product_id]
    ),
    db.query(
      `SELECT COUNT(*)::int AS n
         FROM product_sku_media psm
         JOIN product_skus ps ON ps.id = psm.sku_id
        WHERE ps.product_id = $1`,
      [candidate.product_id]
    ),
    db.query('SELECT COUNT(*)::int AS n FROM catalog_media WHERE product_id = $1', [candidate.product_id]),
  ]);

  if (skus.rows.length < 1) throw new Error('Réparation échouée : aucun SKU');
  if (media.rows[0].n > 0 && links.rows[0].n < 1) {
    throw new Error('Réparation échouée : aucun lien SKU↔média');
  }

  console.log(JSON.stringify({
    ok: true,
    product_id: candidate.product_id,
    promotion,
    skus: skus.rows,
    media_count: media.rows[0].n,
    sku_media_links: links.rows[0].n,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error('Échec réparation SKU pilote :', error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await db.pool.end(); } catch (_) {}
    process.exit(process.exitCode || 0);
  });
