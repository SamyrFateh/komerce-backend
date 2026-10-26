'use strict';
/**
 * R&D ECO read-only owner adapter: JOIN existing upstream and Golden order
 * projections for one explicit order reference; never recreate business logic.
 * No write, no external fetch, no new endpoint, no automatic staging reads.
 */
const {projectContinuity}=require('./golden-continuity-fingerprint');

async function collectGoldenContinuity(db,{
  productId, marketCode, orderReference,
}={},owners={}){
  if(!db||typeof db.query!=='function')throw Error('Read-capable canonical executor required');
  if(!productId||!marketCode||!orderReference)throw Error('Explicit product, market and order reference required');
  const upstreamProjector=owners.upstream||require('../../services/golden-upstream-evidence').projectUpstreamEvidence;
  const orderProjector=owners.order||require('../../services/golden-e2e-cockpit').projectGoldenEvidence;
  const {rows}=await db.query(`SELECT o.id,o.reference,o.status::text AS status,
    o.payment_status::text AS payment_status,m.code AS market_code
    FROM orders o LEFT JOIN markets m ON m.id=o.market_id
    WHERE o.reference=$1 LIMIT 2`,[orderReference]);
  if(rows.length>1)throw Error('Golden order reference is ambiguous; no comparison allowed');
  // Never use the selected market to FILTER the DB order: that would hide
  // exactly the cross-market authority contradiction under investigation.
  const upstream=await upstreamProjector(db,{
    productId,marketCode,orderReference,fetchImpl:null,
  });
  const downstream=rows.length?await orderProjector(db,rows[0]):null;
  const result=projectContinuity(upstream,downstream);
  return {
    ...result,
    execution:'READ_ONLY_OWNER_PROJECTIONS',
    externalStorefrontProbed:false,
    stagingCertified:false,
    humanAccepted:false,
    trace:{product_id:productId,market_code:marketCode,
      order_reference:orderReference,canonical_order_id:rows[0]?.id||null,
      canonical_order_market:rows[0]?.market_code||null},
  };
}
module.exports={collectGoldenContinuity};
