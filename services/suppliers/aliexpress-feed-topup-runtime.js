'use strict';

const db = require('../../db');
const primary = require('../../scripts/aliexpress-500-catalog-sync');
const importer = require('./catalog-import-orchestrator');

const SURFACE_ID = 'feed-category-v1';

function plan(feeds, categories) {
  const fs = feeds.slice(0, 80);
  const cs = categories.slice(0, 48);
  const out = [];
  for (let page = 1; page <= 2; page++) {
    for (const feed of fs) out.push({ feed, page, categoryId: null, categoryName: null });
  }
  for (const category of cs) {
    for (const feed of fs.slice(0, 3)) out.push({ feed, page: 1, categoryId: category.id, categoryName: category.name });
  }
  return out;
}

async function countClean() {
  const { rows: [row] } = await db.query(
    `SELECT COUNT(*)::int count FROM sourcing_candidates sc
      WHERE sc.supplier_name=$1
        AND sc.supplier_product_id IS NOT NULL
        AND sc.state IN ('scanned','imported_to_catalog')
        AND COALESCE(sc.product_name,'')<>''
        AND sc.image_url ~ '^https://'
        AND sc.purchase_price>0
        AND ${primary.stockSqlPredicate('sc')}`,
    [primary.SUPPLIER_NAME]
  );
  return Number(row?.count || 0);
}

async function seenIds() {
  const { rows } = await db.query(
    'SELECT supplier_product_id FROM sourcing_candidates WHERE supplier_name=$1 AND supplier_product_id IS NOT NULL',
    [primary.SUPPLIER_NAME]
  );
  return new Set(rows.map((r) => r.supplier_product_id).filter(Boolean));
}

async function importProducts(config, n, products, spec) {
  if (!products.length) return { accepted: 0, rejected: 0 };
  const result = await importer.importCatalog({
    supplier_name: primary.SUPPLIER_NAME,
    source_type: 'api',
    source_filename: `aliexpress-pool/${config.syncKey}/${SURFACE_ID}/page-${String(n).padStart(4, '0')}.json`,
    notes: `AliExpress ${SURFACE_ID} feed=${spec.feed} category=${spec.categoryId || 'all'} page=${spec.page}`,
  }, null, async () => ({ products, invalid: [], total: products.length }));
  if (result.status !== 200) throw new Error(`Import ${SURFACE_ID} refusé (${result.status})`);
  return result.body;
}

module.exports = { SURFACE_ID, plan, countClean, seenIds, importProducts };
