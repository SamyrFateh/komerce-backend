'use strict';
// CLAUDE-PAR-20261113 : diagnostic en lecture seule des predicats de visibilite publique pour les produits PUBLIES CLAUDE-PAR.
const db = require('../../../db');
const v = require('../../../services/catalog-public-view');
const ids = require('./catalog-publication-ids.json').products;
(async () => {
  const out = [];
  for (const id of ids) {
    const r = {};
    const probes = {
      active_available: `p.is_active=TRUE AND p.is_available=TRUE`,
      no_hold: `NOT EXISTS (SELECT 1 FROM catalog_product_sale_holds h WHERE h.product_id=p.id AND h.released_at IS NULL)`,
      image: `${v.canonicalProductImageSql('p')} IS NOT NULL`,
      sellable_unit: v.sellableCatalogUnitSql('p'),
      full_no_market: v.publicCatalogVisibilitySql('p'),
      full_KM: v.publicCatalogVisibilitySql('p', { marketCodeParamIndex: 2 }),
    };
    for (const [k, sql] of Object.entries(probes)) {
      const params = k === 'full_KM' ? [id, 'KM'] : [id];
      const q = await db.query(`SELECT EXISTS (SELECT 1 FROM products p WHERE p.id=$1::uuid AND ${sql}) AS ok`, params);
      r[k] = q.rows[0].ok;
    }
    const sk = await db.query(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE is_active AND stock>0)::int AS active_stock,
              count(*) FILTER (WHERE is_active AND stock>0 AND COALESCE(source,'MANUAL')='SUPPLIER' AND (
                NULLIF(BTRIM(supplier_sku),'') IS NULL OR NULLIF(BTRIM(supplier_unit_ref),'') IS NULL OR supplier_order_identity IS NULL))::int AS missing_identity,
              count(*) FILTER (WHERE is_active AND stock>0 AND price_kmf IS NOT NULL AND price_kmf<=0)::int AS bad_price
         FROM product_skus WHERE product_id=$1::uuid`, [id]);
    r.skus = sk.rows[0];
    const m = await db.query(`SELECT m.code, pme.commercial_exposure, d.status
         FROM markets m LEFT JOIN product_market_exposure pme ON pme.market_id=m.id AND pme.product_id=$1::uuid
         LEFT JOIN product_market_price_drafts d ON d.market_id=m.id AND d.product_id=$1::uuid WHERE m.code IN ('KM','CM','CG') ORDER BY m.code`, [id]);
    r.markets = m.rows;
    const d = await db.query(
      `SELECT COALESCE(source,'NULL') AS source, (supplier_sku IS NOT NULL AND BTRIM(supplier_sku)<>'') AS has_sku,
              (supplier_unit_ref IS NOT NULL AND BTRIM(supplier_unit_ref)<>'') AS has_unit,
              jsonb_typeof(supplier_order_identity) AS idt, supplier_order_identity->>'provider' AS provider,
              supplier_order_identity->>'version' AS version, jsonb_typeof(supplier_order_identity->'payload') AS payload_t,
              (supplier_order_identity->'payload' = '{}'::jsonb) AS payload_empty, count(*)::int AS n
         FROM product_skus WHERE product_id=$1::uuid AND is_active AND stock>0 GROUP BY 1,2,3,4,5,6,7,8`, [id]);
    r.sku_identity = d.rows;
    const pr = await db.query(`SELECT inventory_model, has_variants, stock, is_active, is_available, lifecycle_status FROM products WHERE id=$1::uuid`, [id]);
    r.product_row = pr.rows[0];
    const ss = await db.query(
      `SELECT count(*) FILTER (WHERE is_active AND stock>0 AND (price_kmf IS NULL OR price_kmf>0))::int AS basic_ok,
              count(*) FILTER (WHERE is_active AND stock>0 AND price_kmf IS NOT NULL AND price_kmf<=0)::int AS neg_price,
              count(*) FILTER (WHERE is_active AND stock>0 AND supplier_order_identity IS NULL)::int AS null_identity,
              count(*) FILTER (WHERE is_active AND stock>0 AND supplier_order_identity->>'provider' !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$')::int AS bad_provider,
              count(*) FILTER (WHERE is_active AND stock>0 AND supplier_order_identity->>'version' !~ '^[1-9][0-9]*$')::int AS bad_version
         FROM product_skus WHERE product_id=$1::uuid`, [id]);
    r.sku_checks = ss.rows[0];
    const one = await db.query(`SELECT supplier_sku, supplier_unit_ref FROM product_skus WHERE product_id=$1::uuid AND is_active ORDER BY created_at, id LIMIT 3`, [id]);
    r.sample_supplier_skus = one.rows;
    const ps = await db.query(`SELECT count(*)::int AS n FROM product_suppliers WHERE product_id=$1::uuid AND deleted_at IS NULL`, [id]);
    r.product_suppliers = ps.rows[0].n;
    out.push({ id: id.slice(0, 8), ...r });
  }
  console.log('DIAG_BEGIN'); console.log(JSON.stringify(out)); console.log('DIAG_END');
  await db.pool.end();
})().catch(e => { console.error('REFUS', e.message); process.exit(1); });
