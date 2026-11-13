'use strict';
// CLAUDE-PAR-20261113 : lecture seule des medias actifs des produits cibles (urls publiques fournisseur).
const db = require('../../../db');
const targets = require('./catalog-targets.json');
(async () => {
  const out = [];
  for (const id of targets.products) {
    const { rows } = await db.query(
      `SELECT cm.id AS media_id, cm.source_media_id, cm.url, cm.option_values, cm.is_active,
              (SELECT UPPER(sc.scan_result->>'sourcing_decision') FROM sourcing_candidates sc
                WHERE sc.product_id=cm.product_id AND sc.state='imported_to_catalog' LIMIT 1) AS decision
         FROM catalog_media cm WHERE cm.product_id=$1::uuid AND cm.is_active=TRUE ORDER BY cm.source_media_id`, [id]);
    out.push({ product_id: id, media: rows });
  }
  console.log('MEDIA_DUMP_BEGIN');
  console.log(JSON.stringify(out));
  console.log('MEDIA_DUMP_END');
  await db.pool.end();
})().catch(e => { console.error('REFUS', e.message); process.exit(1); });
