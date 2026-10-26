/**
 * @komerce-arch
 * @role golden-checkout-thread-projection
 * @domain admin-dashboard
 * @layer service
 * @criticality medium
 * @inputs order_reference, catalog_product_id, market_code, upstream_gates
 * @outputs read_only_checkout_origin_and_payment_gates, single_thread_identity, operator_script
 * @depends services/golden-gate-kit, services/parcel-order-membership
 * @db-read orders, order_items, order_status_history, users, otp_codes, product_skus, markets, cash_collections, parcels, parcel_items
 * @db-write none
 * @db-txn none
 * @doctrine projection_only_no_business_authority, absent_or_ambiguous_proof_is_not_proved, hub_organizes_parcels_freely
 * @impact-areas dashboard, e2e-certification, orders, payments
 * @version 2026-10
 */
'use strict';

const crypto = require('crypto');
const { GATE, check, settle, unproved, safeQuery } = require('./golden-gate-kit');
const { listParcelsRepresentingOrder } = require('./parcel-order-membership');
const EVIDENCE_LEVEL = Object.freeze({ L4_ISOLATED: 'L4_ISOLATED', L5_STAGING: 'L5_STAGING' });
const SYNTHETIC_RX = /^K-GOLDEN-/i;
const BIRTH_NOTE = 'Commande créée';
const resolveEvidenceLevel = (env = process.env) => env.KOMERCE_ENV === 'staging' ? EVIDENCE_LEVEL.L5_STAGING : EVIDENCE_LEVEL.L4_ISOLATED;
function computeTraceId({market,sourceId,captureId,productId,skuIds=[],soiRefs=[],orderReference}) {
  if (!orderReference || !productId) return null;
  return 'GT-' + crypto.createHash('sha256').update([market,sourceId,captureId,productId,[...skuIds].sort().join(','),[...soiRefs].sort().join(','),orderReference].map(x=>x||'').join('|')).digest('hex').slice(0,16);
}
function resolveProvenance({orderReference,gates=[]}) {
  if (!orderReference) return 'NO_ORDER';
  if (SYNTHETIC_RX.test(orderReference)) return 'SYNTHETIC_GOLDEN_CREATE';
  return gates.some(g=>g.key==='CHECKOUT_ORIGIN_PROVED' && g.status===GATE.PROVED) ? 'CHECKOUT_EVENTS_PROVED' : 'ORDER_ORIGIN_NOT_PROVED';
}
const ORIGIN = { key:'CHECKOUT_ORIGIN_PROVED', label:'Checkout réel (Boutique → OTP → Commande)', link:'/boutique/', expected:'Événement checkout, OTP consommé, SKU, prix, relais et destinataire cohérents' };
const PAYMENT = { key:'PAYMENT_FINAL_PROVED', label:'Paiement final', link:'/admin/golden-e2e', expected:'Paiement confirmé par autorité canonique, sans colis avant paiement' };
async function loadOrderBase(db,reference) {
  const r = await safeQuery(db, `SELECT o.id,o.reference,o.user_id,o.status::text AS status,o.payment_status::text AS payment_status,o.payment_mode,o.recipient_id,o.relais_id,o.total_kmf,o.stripe_payment_id,o.created_at,m.code AS market_code FROM orders o LEFT JOIN markets m ON m.id=o.market_id WHERE o.reference=$1 LIMIT 1`,[reference]);
  return r.error ? {error:r.error} : {order:r.rows[0]||null};
}
async function loadCheckoutOriginGate(db,{orderReference,productId,marketCode,base,storefrontGate}) {
  const next='Effectuer OTP et checkout depuis la vraie boutique, puis relire les preuves.';
  if (!orderReference) return unproved(ORIGIN.key,ORIGIN.label,ORIGIN.link,ORIGIN.expected,'order_reference_missing',next);
  if (SYNTHETIC_RX.test(orderReference)) return settle({...ORIGIN,nextAction:next,checks:[check('not_synthetic',false)],anomalies:['Commande synthétique non probante']});
  if (base.error || !base.order) return unproved(ORIGIN.key,ORIGIN.label,ORIGIN.link,ORIGIN.expected,base.error||'order_not_found',next);
  const o=base.order;
  const first=await safeQuery(db,'SELECT status::text AS status,note,changed_by FROM order_status_history WHERE order_id=$1 ORDER BY created_at ASC LIMIT 1',[o.id]);
  const items=await safeQuery(db,'SELECT oi.id,oi.product_id,oi.sku_id,oi.price_kmf,oi.quantity,oi.customs_category_key,ps.product_id AS sku_product_id FROM order_items oi LEFT JOIN product_skus ps ON ps.id=oi.sku_id WHERE oi.order_id=$1 ORDER BY oi.id',[o.id]);
  const user=await safeQuery(db,'SELECT id,phone FROM users WHERE id=$1 LIMIT 1',[o.user_id]);
  if(first.error||items.error||user.error) return unproved(ORIGIN.key,ORIGIN.label,ORIGIN.link,ORIGIN.expected,'canonical_read_unavailable',next);
  const otp=user.rows[0]?.phone ? await safeQuery(db,'SELECT COUNT(*)::int AS n FROM otp_codes WHERE phone=$1 AND verified=TRUE AND consumed_at IS NOT NULL AND consumed_at <= $2',[user.rows[0].phone,o.created_at]) : {rows:[],error:'phone_missing'};
  const ev=first.rows[0],mine=items.rows.filter(i=>i.product_id===productId);
  const shown=storefrontGate?.evidence?.price_kmf;
  const checks=[
    check('birth_event',!!(ev&&ev.note===BIRTH_NOTE&&ev.status==='pending')),
    check('born_by_customer',!!(ev?.changed_by&&ev.changed_by===o.user_id)),
    check('relais_and_recipient',!!(o.relais_id&&o.recipient_id)),
    check('order_matches_selected_market', Boolean(marketCode && o.market_code && String(o.market_code).toUpperCase() === String(marketCode).toUpperCase())),
    check('customs_frozen',items.rows.length>0&&items.rows.every(i=>i.customs_category_key)),
    check('line_is_expected_product',!!productId&&mine.length>0),
    check('line_sku_belongs_to_product',mine.length>0&&mine.every(i=>i.sku_id&&i.sku_product_id===i.product_id)),
    check('otp_consumed_before_order',!otp.error&&Number(otp.rows[0]?.n||0)>0),
    check('price_matches_storefront',mine.length>0&&shown!=null&&mine.every(i=>Number(i.price_kmf)===Number(shown)))
  ];
  const anomalies=mine.some(i=>i.sku_id&&i.sku_product_id&&i.sku_product_id!==i.product_id)?['SKU divergent du produit']: [];
  if (marketCode && o.market_code && String(o.market_code).toUpperCase() !== String(marketCode).toUpperCase()) {
    anomalies.push('ORDER_MARKET_MISMATCH: commande hors marché sélectionné');
  }
  return settle({...ORIGIN,checks,anomalies,nextAction:next,evidence:{order_id:o.id,market_code:o.market_code,sku_ids:mine.map(i=>i.sku_id).filter(Boolean),price_kmf:mine.map(i=>Number(i.price_kmf))},humanChecks:['Parcours boutique observé en navigateur','OTP sandbox observé']});
}
async function loadPaymentFinalGate(db,{orderReference,base}) {
  const next='Confirmer le paiement via son autorité canonique, puis actualiser.';
  if(!orderReference) return unproved(PAYMENT.key,PAYMENT.label,PAYMENT.link,PAYMENT.expected,'order_reference_missing',next);
  if(SYNTHETIC_RX.test(orderReference)) return settle({...PAYMENT,nextAction:next,checks:[check('not_synthetic',false)],anomalies:['Commande synthétique prépayée non probante']});
  if(base.error||!base.order) return unproved(PAYMENT.key,PAYMENT.label,PAYMENT.link,PAYMENT.expected,base.error||'order_not_found',next);
  const o=base.order,paid=o.payment_status==='paid',checks=[check('payment_final',paid)],anomalies=[];
  if(o.payment_mode==='cash_relais') {
    const r=await safeQuery(db,'SELECT COALESCE(SUM(amount_kmf),0)::int AS total,COUNT(*)::int AS n FROM cash_collections WHERE order_id=$1',[o.id]);
    const sum=Number(r.rows[0]?.total||0);
    checks.push(check('cash_collected_matches_total',!r.error&&sum>0&&sum===Number(o.total_kmf)));
    if(!r.error&&sum>Number(o.total_kmf))anomalies.push('Surencaissement');
  } else if (/^(stripe|paypal)/.test(String(o.payment_mode||''))) {
    checks.push(check('psp_reference_present',!!o.stripe_payment_id));
  } else checks.push(check('payment_mode_covered',false));
  if(!paid) {
    const trail=await safeQuery(db,"SELECT COUNT(*)::int AS n FROM order_status_history WHERE order_id=$1 AND status::text <> 'pending'",[o.id]);
    let parcels=[],parcelError=false;
    try { parcels=await listParcelsRepresentingOrder(db,o.id,{columns:'p.id, p.status'}); } catch (_) {parcelError=true;}
    checks.push(check('no_parcel_before_payment',!parcelError&&parcels.length===0));
    if(!trail.error&&Number(trail.rows[0]?.n||0)>0) anomalies.push('Statut avancé sans paiement');
    if(parcels.length)anomalies.push('Colis avant confirmation');
  }
  return settle({...PAYMENT,checks,anomalies,nextAction:next,evidence:{payment_mode:o.payment_mode,payment_status:o.payment_status,total_kmf:Number(o.total_kmf)},humanChecks:['Reçu client visible','Finance cohérente']});
}
const SCREEN_DEFS=Object.freeze([
  {key:'BOUTIQUE',label:'Boutique : produit, variante et prix',gate:'STOREFRONT_PROVED'},
  {key:'OTP',label:'Authentification OTP',gate:'CHECKOUT_ORIGIN_PROVED',check:'otp_consumed_before_order'},
  {key:'CHECKOUT',label:'Checkout et commande',gate:'CHECKOUT_ORIGIN_PROVED'},
  {key:'PAIEMENT',label:'Paiement final',gate:'PAYMENT_FINAL_PROVED'},
  {key:'COCKPIT',label:'Cockpit Golden et dossier',route:'/admin/golden-e2e'}
]);
function buildOperatorScript({gates=[]}={}) {
  let previous=true;
  return SCREEN_DEFS.map(d=>{
    const g=d.gate?gates.find(x=>x.key===d.gate):null;
    let status=g?(d.check?(g.checks.find(c=>c.key===d.check)?.ok?GATE.PROVED:GATE.NON_PROUVE):g.status):(previous?GATE.PROVED:GATE.NON_PROUVE);
    if(g?.status===GATE.ANOMALIE&&!d.check)status=GATE.ANOMALIE;
    const step={key:d.key,label:d.label,route:d.route||null,status,locked:!previous,finding:g?.finding||null};
    previous=previous&&status===GATE.PROVED;
    return step;
  });
}
async function loadCheckoutThread(db,{orderReference,productId,marketCode,upstreamGates=[]}) {
  const ref=orderReference||null,base=ref&&!SYNTHETIC_RX.test(ref)?await loadOrderBase(db,ref):{order:null};
  const origin=await loadCheckoutOriginGate(db,{orderReference:ref,productId,marketCode,base,storefrontGate:upstreamGates.find(g=>g.key==='STOREFRONT_PROVED')});
  const payment=await loadPaymentFinalGate(db,{orderReference:ref,base});
  const src=upstreamGates.find(g=>g.key==='SOURCE_PROVED')?.evidence||{},cat=upstreamGates.find(g=>g.key==='CATALOG_RELEASE_PROVED')?.evidence||{};
  const skuIds=(cat.skus||[]).map(s=>s.product_sku_id).filter(Boolean),soiRefs=(cat.skus||[]).map(s=>s.supplier_unit_ref).filter(Boolean);
  const thread={market:marketCode||base.order?.market_code||null,source_id:src.source_id||null,capture_id:src.capture_id||null,product_id:productId||null,sku_ids:skuIds,soi_unit_refs:soiRefs,order_reference:ref,
    trace_id:computeTraceId({market:marketCode,sourceId:src.source_id,captureId:src.capture_id,productId,skuIds,soiRefs,orderReference:ref})};
  return {gates:[origin,payment],thread};
}
module.exports={EVIDENCE_LEVEL,SCREEN_DEFS,resolveEvidenceLevel,computeTraceId,resolveProvenance,loadCheckoutOriginGate,loadPaymentFinalGate,loadCheckoutThread,buildOperatorScript};
