/**
 * @komerce-arch
 * @role          economic-engine-local-stock-receipt-lots
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        existing W3 receipt, SKU, payment evidence, physical lot attribution
 * @outputs       financially closed lot, attributed sale, comparable local observations
 * @depends       db.js
 * @used-by       routes/admin-costing.js, services/cost-allocation/product-margin-steering.js
 * @db-read       market_delegation_audit, markets, product_skus, products, order_items, orders, local_stock, local_stock_allocations, refunds, disputes, purchase_lines, local_stock_economic_lots, local_stock_economic_lot_lines
 * @db-write      local_stock_economic_lots, local_stock_economic_lot_lines
 * @db-txn        caller-owned-atomic
 * @doctrine      explicit_receipt_and_financial_proof_no_stock_mutation_no_historical_guess
 * @impact-areas  economic-engine, local-stock
 */
'use strict';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw fail('LOCAL_LOT_ID_INVALID', 'Identifiant invalide.');
  return value;
}
function proof(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 200) throw fail('LOCAL_LOT_PROOF_REQUIRED', 'Justificatif obligatoire (200 caractères maximum).');
  return value.trim();
}
function money(value) {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^\d{1,12}(?:\.\d{1,2})?$/.test(String(value))) {
    throw fail('LOCAL_LOT_AMOUNT_INVALID', 'Montant réellement réglé en KMF, positif ou nul, à deux décimales maximum.');
  }
  return String(value);
}
async function marketForCode(q, code) {
  if (typeof code !== 'string' || !/^[A-Z]{2}$/.test(code)) throw fail('MARKET_REQUIRED', 'Marché explicite requis.');
  const { rows: [market] } = await q.query('SELECT id FROM markets WHERE code=$1 AND is_active=TRUE', [code]);
  if (!market) throw fail('MARKET_NOT_FOUND', 'Marché introuvable.', 404);
  return market.id;
}
// Sale eligibility requires the existing consumed stock allocation, a fully
// collected paid line and no refund/dispute/import purchase on that line.
const saleEligible = `oi.fulfillment_source='LOCAL_STOCK'
    AND oi.sku_id IS NOT NULL AND oi.qty_collected=oi.quantity
    AND o.status='collected' AND o.payment_status='paid' AND o.simulation_scope IS NULL
    AND NOT EXISTS (SELECT 1 FROM refunds rf WHERE rf.order_id=o.id)
    AND NOT EXISTS (SELECT 1 FROM disputes d WHERE d.order_id=o.id AND d.status IN ('open','processing'))
    AND NOT EXISTS (SELECT 1 FROM purchase_lines pl WHERE pl.order_item_id=oi.id AND pl.cancelled_at IS NULL)
    AND (SELECT COALESCE(SUM(a.quantity),0) FROM local_stock_allocations a
         JOIN local_stock ls ON ls.id=a.local_stock_id
         WHERE a.order_id=o.id AND a.consumed_at IS NOT NULL AND a.released_at IS NULL
           AND ls.product_id=oi.product_id AND ls.market_id=o.market_id)
        = (SELECT COALESCE(SUM(i.quantity),0) FROM order_items i WHERE i.order_id=o.id
           AND i.product_id=oi.product_id AND i.fulfillment_source='LOCAL_STOCK')`;
async function list(q, marketId) {
  const { rows: receipts } = await q.query(
    `SELECT a.id AS receipt_id, a.occurred_at AS received_at, a.payload_after->>'sku_id' AS sku_id,
       a.payload_after->>'proof_ref' AS receipt_proof_ref, a.payload_after->>'qty_received' AS quantity,
       p.name AS product_name, sku.sku AS sku_reference, lot.purchase_total_kmf, lot.closed_at,
       (SELECT COALESCE(SUM(l.quantity),0)::int FROM local_stock_economic_lot_lines l WHERE l.receipt_id=a.id) AS linked_quantity
       FROM market_delegation_audit a
       JOIN product_skus sku ON sku.id::text=a.payload_after->>'sku_id' AND sku.product_id::text=a.payload_after->>'product_id'
       JOIN products p ON p.id=sku.product_id
       LEFT JOIN local_stock_economic_lots lot ON lot.receipt_id=a.id
      WHERE a.market_id=$1 AND a.action='LOCAL_STOCK_RECEIPT'
      ORDER BY a.occurred_at DESC, a.id LIMIT 200`, [marketId]);
  const { rows: sales } = await q.query(
    `SELECT oi.id AS order_item_id, oi.sku_id, oi.quantity, o.reference AS order_reference, o.created_at AS sold_at,
       oi.quantity-(SELECT COALESCE(SUM(l.quantity),0)::int FROM local_stock_economic_lot_lines l WHERE l.order_item_id=oi.id) AS remaining_quantity
       FROM order_items oi JOIN orders o ON o.id=oi.order_id
      WHERE o.market_id=$1 AND ${saleEligible}
        AND oi.quantity>(SELECT COALESCE(SUM(l.quantity),0) FROM local_stock_economic_lot_lines l WHERE l.order_item_id=oi.id)
      ORDER BY o.created_at DESC, oi.id LIMIT 200`, [marketId]);
  return { receipts, sales };
}
async function close(q, { marketId, receiptId, purchaseTotalKmf, paymentProofRef, actorId }) {
  uuid(receiptId); const amount=money(purchaseTotalKmf); const ref=proof(paymentProofRef);
  // Serialize close and retries against the actual immutable W3 receipt.
  const { rows: [receipt] } = await q.query(
    `SELECT a.id, sku.id AS sku_id, a.payload_after->>'qty_received' AS quantity
       FROM market_delegation_audit a
       JOIN product_skus sku ON sku.id::text=a.payload_after->>'sku_id' AND sku.product_id::text=a.payload_after->>'product_id'
      WHERE a.id=$1 AND a.market_id=$2 AND a.action='LOCAL_STOCK_RECEIPT'
        AND length(btrim(a.payload_after->>'proof_ref'))>0 FOR UPDATE OF a`, [receiptId, marketId]);
  if (!receipt) throw fail('LOCAL_LOT_RECEIPT_UNPROVEN', 'Réception de ce SKU non attestée dans ce marché.', 404);
  const qty=Number(receipt.quantity);
  if (!Number.isSafeInteger(qty) || qty<=0) throw fail('LOCAL_LOT_RECEIPT_QUANTITY_INVALID', 'Quantité de réception invalide.', 409);
  const { rows: [lot] } = await q.query(
    `INSERT INTO local_stock_economic_lots(receipt_id,sku_id,market_id,quantity,purchase_total_kmf,payment_proof_ref,closed_by)
     VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(receipt_id) DO NOTHING RETURNING *`,
    [receiptId,receipt.sku_id,marketId,qty,amount,ref,actorId]);
  if (lot) return lot;
  const { rows: [existing] } = await q.query(
    'SELECT * FROM local_stock_economic_lots WHERE receipt_id=$1 AND market_id=$2 AND purchase_total_kmf=$3::numeric AND payment_proof_ref=$4',
    [receiptId,marketId,amount,ref]);
  if (!existing) throw fail('LOCAL_LOT_CLOSED', 'Lot déjà clôturé avec des preuves différentes.', 409);
  return existing;
}
async function link(q, { marketId, receiptId, orderItemId, lotProofRef, actorId, quantity = null }) {
  uuid(receiptId); uuid(orderItemId); const ref=proof(lotProofRef);
  const { rows: [lot] } = await q.query(
    `SELECT l.*, a.occurred_at AS received_at
       FROM local_stock_economic_lots l JOIN market_delegation_audit a ON a.id=l.receipt_id
      WHERE l.receipt_id=$1 AND l.market_id=$2 FOR UPDATE OF l`, [receiptId,marketId]);
  if (!lot) throw fail('LOCAL_LOT_NOT_CLOSED', 'Lot financier non clôturé dans ce marché.', 409);
  const { rows: [sale] } = await q.query(
    `SELECT oi.id,oi.quantity FROM order_items oi JOIN orders o ON o.id=oi.order_id
      WHERE oi.id=$1 AND o.market_id=$2 AND oi.sku_id=$3 AND o.created_at >= $4
        AND ${saleEligible} FOR UPDATE OF oi,o`, [orderItemId,marketId,lot.sku_id,lot.received_at]);
  if (!sale) throw fail('LOCAL_LOT_SALE_UNPROVEN', 'Vente non admissible, SKU/marché différent ou antérieure à la réception.', 409);
  const qty=quantity===null ? Number(sale.quantity) : quantity;
  if (!Number.isSafeInteger(qty) || qty<=0 || qty>Number(sale.quantity)) throw fail('LOCAL_LOT_LINK_QUANTITY_INVALID','Quantité attestée invalide.');
  const { rows: [existing] } = await q.query('SELECT * FROM local_stock_economic_lot_lines WHERE order_item_id=$1 AND receipt_id=$2', [orderItemId,receiptId]);
  if (existing) {
    if (existing.receipt_id===receiptId && Number(existing.quantity)===qty && existing.lot_proof_ref===ref) return existing;
    throw fail('LOCAL_LOT_SALE_ALREADY_LINKED', 'Ce couple vente/lot a déjà une preuve différente.', 409);
  }
  const { rows: [used] } = await q.query('SELECT COALESCE(SUM(quantity),0)::int AS quantity FROM local_stock_economic_lot_lines WHERE receipt_id=$1', [receiptId]);
  if (Number(used.quantity)+qty>Number(lot.quantity)) throw fail('LOCAL_LOT_QUANTITY_EXCEEDED', 'Quantité du lot insuffisante.', 409);
  const { rows: [assigned] } = await q.query('SELECT COALESCE(SUM(quantity),0)::int AS quantity FROM local_stock_economic_lot_lines WHERE order_item_id=$1',[orderItemId]);
  if (Number(assigned.quantity)+qty>Number(sale.quantity)) throw fail('LOCAL_LOT_SALE_QUANTITY_EXCEEDED','Quantité vendue déjà attribuée.',409);
  // Cumulative rounding conserves the exact documented purchase total when the lot is fully attributed.
  const { rows: [linked] } = await q.query(
    `INSERT INTO local_stock_economic_lot_lines(order_item_id,receipt_id,quantity,purchase_kmf,lot_proof_ref,linked_by)
     SELECT $1,receipt_id,$3::integer,ROUND(purchase_total_kmf*($4::numeric+($3::integer)::numeric)/quantity,2)
       -ROUND(purchase_total_kmf*$4::numeric/quantity,2),$5,$6
       FROM local_stock_economic_lots WHERE receipt_id=$2 RETURNING *`,
    [orderItemId,receiptId,qty,used.quantity,ref,actorId]);
  return linked;
}
async function loadComparable(q, marketId, ids) {
  if (!ids.length) return new Map();
  const { rows } = await q.query(
    `SELECT x.order_item_id, x.receipt_id AS shipment_id, 'LOCAL_STOCK' AS rail,
       l.closed_at AS financial_closed_at, x.purchase_kmf, x.quantity AS part_quantity, oi.quantity AS sale_quantity,
       (SELECT COUNT(*)::int FROM local_stock_economic_lot_lines other WHERE other.receipt_id=l.receipt_id) AS sku_line_count
       FROM local_stock_economic_lot_lines x
       JOIN local_stock_economic_lots l ON l.receipt_id=x.receipt_id
       JOIN market_delegation_audit a ON a.id=l.receipt_id AND a.market_id=l.market_id
       JOIN order_items oi ON oi.id=x.order_item_id AND oi.sku_id=l.sku_id
       JOIN orders o ON o.id=oi.order_id AND o.market_id=l.market_id
      WHERE x.order_item_id=ANY($1::uuid[]) AND l.market_id=$2 AND o.created_at>=a.occurred_at
        AND ${saleEligible}`, [ids,marketId]);
  return groupCompleteSaleLots(rows);
}
function groupCompleteSaleLots(rows) {
  const groups=new Map();
  for (const row of rows) {
    const group=groups.get(row.order_item_id)||[];
    group.push(row);groups.set(row.order_item_id,group);
  }
  const result=new Map();
  for (const [id,parts] of groups) {
    const saleQty=Number(parts[0].sale_quantity);
    if (!Number.isSafeInteger(saleQty)||saleQty<=0 ||
        new Set(parts.map(p=>p.shipment_id)).size!==parts.length ||
        parts.some(p=>!Number.isSafeInteger(Number(p.part_quantity))||Number(p.part_quantity)<=0 ||
          Number(p.sale_quantity)!==saleQty || p.purchase_kmf==null || !Number.isFinite(Number(p.purchase_kmf))) ||
        parts.reduce((s,p)=>s+Number(p.part_quantity),0)!==saleQty) continue;
    const purchase=parts.reduce((s,p)=>s+Math.round(Number(p.purchase_kmf)*100),0)/100;
    result.set(id,{...parts[0],purchase_kmf:purchase,parts});
  }
  return result;
}
module.exports = { marketForCode, list, close, link, loadComparable, groupCompleteSaleLots, money, proof };
