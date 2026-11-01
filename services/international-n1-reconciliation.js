/**
 * @komerce-arch
 * @role          international-n1-reconciliation-owner
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        server_resolved_market, authorized_admin_actor, immutable_international_facts
 * @outputs       traceable_real_order_item_n1, conserved_cent_balances
 * @depends       db, crypto, ./cost-allocation/_helpers, ./cost-allocation/canonical-margin-writer
 * @used-by       routes/admin-shipping-customs-workspace.js
 * @db-read       international_shipments, international_shipment_parcels, international_shipment_charges, international_n1_reconciliations, international_n1_allocation_links, customs_shipments, customs_shipment_fees, customs_shipment_parcels, parcels, orders, order_items, parcel_items, order_item_real_cost_allocations
 * @db-write      international_n1_reconciliations, international_n1_allocation_links, order_item_real_cost_allocations
 * @db-txn        withTransaction
 * @doctrine      N1_actual_only, no_duplicate_legacy_freight_or_fees, no_N3, source_snapshot_idempotency, conserve_cents
 * @impact-areas  economic-engine, logistics, customs, security, dashboard
 */
'use strict';

const crypto = require('crypto');
const db = require('../db');
const { shareByWeight } = require('./cost-allocation/_helpers');

class ReconciliationError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
const fail = (code, message) => { throw new ReconciliationError(code, message); };
const cents = value => {
  if (value == null || !Number.isFinite(Number(value)) || Number(value) < 0) {
    fail('INTERNATIONAL_N1_AMOUNT_INVALID', 'Montant réel manquant ou invalide');
  }
  const n = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(n)) fail('INTERNATIONAL_N1_AMOUNT_UNSAFE', 'Montant hors plage fiable');
  return n;
};
const format = n => (n / 100).toFixed(2);
const sum = values => values.reduce((acc, n) => acc + n, 0);
const split = (n, entries, component) => {
  if (n === 0) return entries.map(e => ({id:e.id, share:0}));
  if (!entries.length) fail('INTERNATIONAL_N1_NO_CARRIER', 'Aucune cible pour ' + component);
  if (!entries.some(e => Number(e.weight) > 0)) {
    fail('INTERNATIONAL_N1_NO_WEIGHT', 'Aucun poids pour ' + component);
  }
  const shares = shareByWeight(n, entries);
  if (sum(shares.map(s => s.share)) !== n) fail('INTERNATIONAL_N1_NOT_CONSERVED','Ventilation non conservée');
  return shares;
};
function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function allocatedItems(items, p) {
  let pool = items.filter(i => String(i.parcel_id) === String(p.parcel_id));
  if (!pool.length) pool = p.fallback_items || [];
  if (!pool.length) fail('INTERNATIONAL_N1_NO_ORDER_ITEMS', 'Colis sans ligne de commande');
  if (pool.some(i => String(i.order_id) !== String(p.order_id))) {
    fail('INTERNATIONAL_N1_ORDER_MISMATCH', 'Ligne rattachée à une autre commande');
  }
  const fallback = !(items.some(i => String(i.parcel_id) === String(p.parcel_id)));
  const entries = pool.map(i => ({id:String(i.order_item_id),weight:Number(i.quantity) || 1}));
  return {pool,entries,fallback};
}

/**
 * Explicit, controlled reconciliation. Never writes the legacy customs shipment_id:
 * the existing customs allocator deletes/rebuilds its own rows by that FK.
 * Source-owned allocations use a separate FK link and NULL legacy shipment_id.
 */
async function reconcile(market, actor, reference, database = db) {
  if (!market || !market.id || !market.code || !actor || !actor.id || actor.role !== 'admin') {
    throw new ReconciliationError('INTERNATIONAL_N1_FORBIDDEN','Autorité Admin et marché serveur requis',403);
  }
  if (!database || typeof database.withTransaction !== 'function') {
    throw new Error('INTERNATIONAL_N1_TRANSACTION_REQUIRED');
  }
  return database.withTransaction(async client => {
    const {rows:[s]} = await client.query(
      'SELECT s.*, cs.is_active AS customs_active, cs.freight_kmf AS legacy_freight_kmf, cs.market_id AS customs_market_id ' +
      'FROM international_shipments s LEFT JOIN customs_shipments cs ON cs.id=s.customs_shipment_id ' +
      'WHERE s.market_id=$1 AND s.reference=$2 FOR UPDATE OF s',
      [market.id,reference]
    );
    if (!s) fail('INTERNATIONAL_N1_NOT_FOUND','Transport absent sur ce marché');
    if (!s.customs_shipment_id || !s.customs_active || String(s.customs_market_id) !== String(market.id)) {
      fail('INTERNATIONAL_N1_CUSTOMS_LINK_REQUIRED','Dossier douane actif de même marché requis');
    }
    // Serialize against legacy fee mutations which lock customs_shipments FOR UPDATE.
    const {rows:[legacy]} = await client.query(
      'SELECT id, is_active, freight_kmf FROM customs_shipments WHERE id=$1 AND market_id=$2 FOR UPDATE',
      [s.customs_shipment_id,market.id]
    );
    if (!legacy || !legacy.is_active) fail('INTERNATIONAL_N1_CUSTOMS_INACTIVE','Dossier douane inactif');
    if (legacy.freight_kmf != null && cents(legacy.freight_kmf) > 0 && s.freight_invoice_kmf != null) {
      fail('INTERNATIONAL_N1_DUPLICATE_FREIGHT','Fret réel déjà imputé dans le dossier douane');
    }
    const {rows:fees} = await client.query(
      'SELECT fee_type,kind,amount_kmf,proof_ref,id FROM international_shipment_charges ' +
      'WHERE shipment_id=$1 ORDER BY recorded_at,id',[s.id]
    );
    const {rows:legacyFees} = await client.query(
      'SELECT fee_type,proof_ref,kind,amount_kmf FROM customs_shipment_fees WHERE shipment_id=$1 ORDER BY fee_type,proof_ref,kind,amount_kmf',
      [s.customs_shipment_id]
    );
    // Deliberately conservative: same kind of arrival charge in both ledgers
    // needs a single source of truth before N1 can be published.
    const internationalKinds = new Set(fees.filter(f=>f.fee_type!=='local_transport').map(f=>f.fee_type));
    if (legacyFees.some(f=>internationalKinds.has(f.fee_type))) {
      fail('INTERNATIONAL_N1_OVERLAPPING_CUSTOMS_FEES',
        'Même famille de frais saisie en douane et en transport : arbitrage de source requis');
    }
    const proofs = new Set([
      ...(s.freight_invoice_ref ? [String(s.freight_invoice_ref).trim().toLowerCase()] : []),
      ...fees.map(f=>String(f.proof_ref).trim().toLowerCase()),
    ]);
    if (legacyFees.some(f=>proofs.has(String(f.proof_ref).trim().toLowerCase()))) {
      fail('INTERNATIONAL_N1_DUPLICATE_PROOF','Même justificatif déjà présent en douane');
    }
    const {rows:parcels} = await client.query(
      'SELECT ip.parcel_id,ip.volume_cm3,p.order_id,o.market_id FROM international_shipment_parcels ip ' +
      'JOIN parcels p ON p.id=ip.parcel_id JOIN orders o ON o.id=p.order_id ' +
      'WHERE ip.shipment_id=$1 ORDER BY ip.parcel_id',[s.id]
    );
    if (!parcels.length || parcels.some(p=>String(p.market_id)!==String(market.id))) {
      fail('INTERNATIONAL_N1_PARCELS_INVALID','Colis manquants ou hors marché');
    }
    const {rows:[membership]} = await client.query(
      'SELECT COUNT(*)::int AS bad FROM customs_shipment_parcels csp ' +
      'WHERE csp.shipment_id=$1 AND NOT EXISTS ' +
      '(SELECT 1 FROM international_shipment_parcels ip WHERE ip.shipment_id=$2 AND ip.parcel_id=csp.parcel_id)',
      [s.customs_shipment_id,s.id]
    );
    if (Number(membership.bad)>0) fail('INTERNATIONAL_N1_CUSTOMS_PARCEL_MISMATCH','Colis douane hors dossier transport');
    const ids=parcels.map(p=>p.parcel_id);
    const {rows:items}=await client.query(
      'SELECT pi.parcel_id,pi.order_item_id,oi.order_id,SUM(pi.quantity)::numeric AS quantity ' +
      'FROM parcel_items pi JOIN order_items oi ON oi.id=pi.order_item_id ' +
      'WHERE pi.parcel_id=ANY($1::uuid[]) GROUP BY pi.parcel_id,pi.order_item_id,oi.order_id ' +
      'ORDER BY pi.parcel_id,pi.order_item_id',[ids]
    );
    for (const p of parcels) {
      if (!items.some(i=>String(i.parcel_id)===String(p.parcel_id))) {
        const {rows}=await client.query(
          'SELECT id AS order_item_id, order_id, quantity FROM order_items WHERE order_id=$1 ORDER BY id',
          [p.order_id]
        );
        p.fallback_items=rows;
      }
      allocatedItems(items,p);
    }
    const feeNets=new Map();
    for (const fee of fees) {
      const amount=cents(fee.amount_kmf);
      const net=(feeNets.get(fee.fee_type)||0)+(fee.kind==='credit'?-amount:amount);
      feeNets.set(fee.fee_type,net);
    }
    if ([...feeNets.values()].some(v=>v<0)) {
      fail('INTERNATIONAL_N1_NEGATIVE_FEE','Avoir supérieur aux frais de sa famille');
    }
    const freight=s.freight_invoice_kmf == null?null:cents(s.freight_invoice_kmf);
    const components=[];
    if(freight===null && fees.length===0){
      fail('INTERNATIONAL_N1_NO_REAL_FACTS','Aucune facture ou frais réel à rapprocher');
    }
    if (freight !== null) {
      if (s.transport_mode==='air' && freight>0) {
        fail('INTERNATIONAL_N1_AIR_CALIBRATION_PENDING',
          'Poids taxable aérien non calibré : aucune répartition arbitraire');
      }
      components.push({component:'freight',fee_type:'',amount:freight,
        weight:'volume'});
    }
    for (const [feeType,amount] of [...feeNets.entries()].sort(([a],[b])=>a.localeCompare(b))) {
      components.push({component:feeType==='local_transport'?'local_distribution':'port_transitaire',
        fee_type:feeType,amount,weight:'equal'});
    }
    const scope={ship:s.id,market:market.id,customs:s.customs_shipment_id,
      legacyFreight:legacy.freight_kmf,legacyFees,freight:s.freight_invoice_kmf,
      invoice:s.freight_invoice_ref,fees,parcels,items,components};
    const hash=fingerprint(scope);
    const {rows:[old]}=await client.query(
      'SELECT snapshot_hash, allocation_rows FROM international_n1_reconciliations WHERE shipment_id=$1',
      [s.id]
    );
    const {rows:[linkCount]}=await client.query(
      'SELECT COUNT(*)::int AS n FROM international_n1_allocation_links WHERE shipment_id=$1',[s.id]
    );
    if (old && old.snapshot_hash===hash && Number(linkCount.n)===Number(old.allocation_rows)) {
      return {reference:s.reference,status:freight===null?'partial_reconciliation':'reconciled',idempotent:true,
        actual_n1_kmf:format(sum(components.map(c=>c.amount))),allocation_rows:old.allocation_rows};
    }
    // Only our projection is re-created; customs, manual and other sources stay untouched.
    await client.query(
      'DELETE FROM order_item_real_cost_allocations a USING international_n1_allocation_links l ' +
      'WHERE a.id=l.allocation_id AND l.shipment_id=$1',[s.id]
    );
    let count=0;
    let savedCents=0;
    for (const c of components) {
      if (!c.amount) continue;
      const hasVolume=parcels.some(p=>Number(p.volume_cm3)>0);
      const fallback=c.weight==='equal'||!hasVolume;
      const pShares=split(c.amount,parcels.map(p=>({
        id:String(p.parcel_id),
        weight:fallback?1:Number(p.volume_cm3)||0,
      })),c.component);
      for (const pShare of pShares) {
        if (!pShare.share) continue;
        const parcel=parcels.find(p=>String(p.parcel_id)===String(pShare.id));
        const target=allocatedItems(items,parcel);
        const lineShares=split(pShare.share,target.entries,c.component);
        for (const part of lineShares) {
          if (!part.share) continue;
          const item=target.pool.find(i=>String(i.order_item_id)===String(part.id));
          const confidence=fallback||target.fallback?'low':'high';
          const method=fallback||target.fallback?'estimated_fallback':
            (c.weight==='volume'?'by_volume':'by_quantity');
          const {rows:[allocation]}=await client.query(
            'INSERT INTO order_item_real_cost_allocations ' +
            '(order_id,order_item_id,parcel_id,shipment_id,cost_type,amount_kmf,allocation_method,source,is_actual,confidence,notes) ' +
            'VALUES($1,$2,$3,NULL,$4,$5,$6,$7,TRUE,$8,$9) RETURNING id',
            [item.order_id,item.order_item_id,parcel.parcel_id,c.component,format(part.share),
              method,c.component==='freight'?'international_shipments':'international_shipment_charges',
              confidence,'international_shipment_id='+s.id+';fee_type='+c.fee_type]
          );
          await client.query(
            'INSERT INTO international_n1_allocation_links ' +
            '(allocation_id,shipment_id,component,fee_type,parcel_id,order_item_id) VALUES($1,$2,$3,$4,$5,$6)',
            [allocation.id,s.id,c.component,c.fee_type,parcel.parcel_id,item.order_item_id]
          );
          savedCents+=part.share;
          count++;
        }
      }
    }
    const total=sum(components.map(c=>c.amount));
    if (total!==savedCents) fail('INTERNATIONAL_N1_NOT_CONSERVED','Les allocations ne totalisent pas les factures');
    const arrival=sum(components.filter(c=>c.component==='port_transitaire').map(c=>c.amount));
    const local=sum(components.filter(c=>c.component==='local_distribution').map(c=>c.amount));
    await client.query(
      'INSERT INTO international_n1_reconciliations ' +
      '(shipment_id,snapshot_hash,total_freight_kmf,total_arrival_kmf,total_local_kmf,allocation_rows,actor_id,freight_known) ' +
      'VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(shipment_id) DO UPDATE SET ' +
      'snapshot_hash=EXCLUDED.snapshot_hash,total_freight_kmf=EXCLUDED.total_freight_kmf,' +
      'total_arrival_kmf=EXCLUDED.total_arrival_kmf,total_local_kmf=EXCLUDED.total_local_kmf,' +
      'allocation_rows=EXCLUDED.allocation_rows,freight_known=EXCLUDED.freight_known,actor_id=EXCLUDED.actor_id,reconciled_at=now()',
      [s.id,hash,format(freight||0),format(arrival),format(local),count,String(actor.id),freight!==null]
    );
    const {refreshCanonicalMarginForOrders}=require('./cost-allocation/canonical-margin-writer');
    await refreshCanonicalMarginForOrders([...new Set(parcels.map(p=>p.order_id))],{client});
    return {reference:s.reference,status:freight===null?'partial_reconciliation':'reconciled',idempotent:false,
      actual_n1_kmf:format(total),freight_kmf:format(freight||0),arrival_kmf:format(arrival),
      local_kmf:format(local),allocation_rows:count};
  });
}
module.exports={reconcile,ReconciliationError,_internals:{cents,format,split,fingerprint}};
