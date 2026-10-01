/**
 * @komerce-arch
 * @role          purchase-line-snapshot
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        order_item, product_supplier_mapping, canonical_procurement_readiness
 * @outputs       purchase_line_rows, supplier_money, procurement_hub_ref
 * @depends       services/suppliers/supplier-order-identity.js, services/suppliers/canonical-unit-purchasing-gate.js, services/suppliers/execution-adapter-registry.js
 * @used-by       services/purchasing-trigger-service.js, services/purchasing-admin-service.js, services/purchasing-cancel-service.js
 * @db-read       product_skus
 * @db-write      purchase_lines
 * @db-txn        caller_owned
 * @doctrine      docs/doctrine/DOCTRINE_PROCUREMENT_FULFILLMENT.md, docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md, docs/doctrine/DOCTRINE_CANONICAL_UNIT_PURCHASING.md
 * @impact-areas  purchasing, supplier-integration
 * @version       2026-10
 */

'use strict';

// Instantané d'une ligne d'achat : tout ce qui décide « quoi acheter, chez qui, à quel prix attendu,
// vers quel Procurement Hub » est figé ici, une seule fois, au moment du besoin. Ce module ne décide
// rien d'autre : il ne notifie personne, n'appelle aucun fournisseur et ne touche jamais orders.status.

const { blockedSupplierIdentity, normalizeIdentity } = require('./suppliers/supplier-order-identity');
const { EXECUTION_ADAPTER_REGISTRY } = require('./suppliers/execution-adapter-registry');
const { evaluateCanonicalProcurementReadiness } = require('./suppliers/canonical-unit-purchasing-gate');

// Procurement Hub V1 = Dubai (DOCTRINE_PROCUREMENT_FULFILLMENT §5) : un rôle, pas une constante métier.
const DEFAULT_PROCUREMENT_HUB_REF = 'DXB';

function resolveProcurementHubRef() {
  const configured = String(process.env.KOMERCE_PROCUREMENT_HUB_REF || '').trim();
  return configured || DEFAULT_PROCUREMENT_HUB_REF;
}

// Libellé lisible pour les messages fournisseur ; le texte historique « Hub Dubai » est conservé pour DXB.
function procurementHubLabel(hubRef) {
  return hubRef === DEFAULT_PROCUREMENT_HUB_REF ? 'Dubai' : hubRef;
}

function requireSupplierMoney(target) {
  const amount = Number(target?.supplier_unit_price ?? target?.supplier_price_aed);
  const currency = String(
    target?.supplier_currency || (target?.supplier_price_aed != null ? 'AED' : '')
  ).trim().toUpperCase();
  if (!Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(currency)) {
    throw new Error('SUPPLIER_MONEY_UNAVAILABLE');
  }
  return { amount, currency };
}

async function loadExactSoldSku(client, item) {
  if (!item.sku_id) return null;
  const { rows: [sku] } = await client.query(`
    SELECT id, product_id, supplier_sku, supplier_unit_ref, supplier_order_identity
    FROM product_skus WHERE id = $1 AND product_id = $2 LIMIT 1
  `, [item.sku_id, item.product_id]);
  if (!sku) throw blockedSupplierIdentity('product_sku vendu introuvable', { product_sku_id: item.sku_id, product_id: item.product_id });
  const supplierSku = String(sku.supplier_sku || '').trim();
  if (!supplierSku) throw blockedSupplierIdentity('supplier_sku absent sur le product_sku vendu', { product_sku_id: sku.id });
  const supplierUnitRef = String(sku.supplier_unit_ref || '').trim() || null;
  const identity = normalizeIdentity(sku.supplier_order_identity, supplierUnitRef);
  return { ...sku, supplier_sku: supplierSku, supplier_unit_ref: supplierUnitRef, supplier_order_identity: identity };
}

/**
 * GAP-4A — décision de readiness canonique pour le SKU exactement vendu,
 * via le moteur unique (canonical-unit-purchasing-gate.js), plutôt qu'une
 * résolution money réimplémentée en ligne. Le gate décide (identité, stock,
 * prix, preflight distant si requis par l'autorité provider) ; cette
 * fonction ne fait que traduire son verdict dans la forme attendue par
 * triggerPurchasing — aucune logique métier supplémentaire ici.
 *
 * Le cross-check fort SOI vendue ↔ SOI canonique (provider+version+payload)
 * reste obligatoire : il est appliqué par le gate lui-même via
 * `soldIdentity`, jamais réimplémenté ici.
 *
 * `context` est transmis tel quel à `adapter.evaluate()` (via le gate) —
 * seam de test déjà établi par les adapters eux-mêmes, jamais interprété
 * ici. Vide par défaut ({}) : comportement de production inchangé.
 */
async function resolveExactSkuProcurementReadiness(client, exactSku, quantity, context = {}) {
  const readiness = await evaluateCanonicalProcurementReadiness({
    productSkuId: exactSku.id,
    quantity,
    soldIdentity: exactSku.supplier_order_identity,
    query: client.query.bind(client),
    adapters: EXECUTION_ADAPTER_REGISTRY,
    context,
  });
  if (!readiness.ready) {
    throw blockedSupplierIdentity(readiness.reason || readiness.status, readiness.evidence || {});
  }
  return {
    unit_price: readiness.money.unit_price,
    currency: readiness.money.currency,
    canonical_unit_id: readiness.canonical_unit_id,
    canonical_unit: readiness.canonical_unit,
    supplier_unit_ref: readiness.supplier_unit_ref,
    supplier_order_identity: readiness.identity,
    preflight: readiness.preflight,
  };
}

/**
 * Cible d'achat figée pour un item : fusion du mapping fournisseur et, si le SKU vendu est exact,
 * de l'identité et du prix canoniques. Le chemin historique (sans SKU exact) garde le prix AED du mapping.
 */
function buildPurchaseTarget(ps, exactSku, canonicalMoney) {
  const purchaseTarget = exactSku ? {
    ...ps,
    supplier_sku: exactSku.supplier_sku,
    supplier_unit_price: canonicalMoney.unit_price,
    supplier_currency: canonicalMoney.currency,
  } : {
    ...ps,
    supplier_unit_price: Number(ps.supplier_price_aed),
    supplier_currency: 'AED',
  };
  const money = requireSupplierMoney(purchaseTarget);
  return {
    purchaseTarget,
    money,
    unitPriceAed: money.currency === 'AED' ? money.amount : null,
    supplierUnitRef: exactSku ? canonicalMoney.supplier_unit_ref : null,
    supplierOrderIdentity: exactSku ? canonicalMoney.supplier_order_identity : null,
  };
}

/**
 * Écriture double (PR 1) : la ligne d'achat d'une PO historique est écrite dans la MÊME transaction
 * que la PO. Sans order_item, aucune traçabilité n'est possible : on ne crée pas de ligne.
 * La garde I1 (base) refuse un sur-engagement de l'order_item.
 */
async function insertHistoricalPurchaseLine(client, { purchaseOrderId, item, ps, snapshot, quantity }) {
  if (!item?.id) return null;
  const { rows: [line] } = await client.query(`
    INSERT INTO purchase_lines
      (purchase_order_id, order_item_id, supplier_id, product_supplier_id, product_sku_id,
       supplier_sku, supplier_unit_ref, supplier_order_identity, quantity,
       supplier_unit_price, supplier_currency, procurement_hub_ref)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12)
    RETURNING id
  `, [
    purchaseOrderId, item.id, ps.supplier_id, ps.id, snapshot.productSkuId || null,
    snapshot.purchaseTarget.supplier_sku, snapshot.supplierUnitRef,
    snapshot.supplierOrderIdentity ? JSON.stringify(snapshot.supplierOrderIdentity) : null,
    quantity, snapshot.money.amount, snapshot.money.currency, resolveProcurementHubRef(),
  ]);
  return line || null;
}

/** Confirmation d'une PO historique : la ligne unique porte la quantité et le prix confirmés. */
async function confirmHistoricalPurchaseLine(client, purchaseOrderId, { quantity, unitPrice = null }) {
  await client.query(`
    UPDATE purchase_lines
       SET confirmed_quantity = $2, confirmed_unit_price = $3, confirmed_at = NOW(), updated_at = NOW()
     WHERE purchase_order_id = $1 AND confirmed_quantity IS NULL AND cancelled_at IS NULL
  `, [purchaseOrderId, quantity, unitPrice]);
}

/**
 * Couverture d'un order_item (PR 2) : l'item est couvert quand la somme des quantités effectives de ses lignes
 * non annulées atteint sa quantité. Contrairement à l'ancienne recherche « même fournisseur », elle empêche
 * aussi de racheter un item déjà couvert par un AUTRE fournisseur (anti-double-achat). Retourne la PO qui couvre
 * (id peut être null pour une ligne ouverte, PR 4) ou null si l'item n'est pas couvert.
 */
async function findItemCoverage(client, item) {
  if (!item?.id) return null;
  const { rows } = await client.query(`
    SELECT purchase_order_id AS id, po_status AS status, effective_quantity
      FROM v_purchase_line_progress
     WHERE order_item_id = $1 AND NOT cancelled
     ORDER BY purchase_order_id NULLS LAST
  `, [item.id]);
  const covered = rows.reduce((sum, r) => sum + Number(r.effective_quantity || 0), 0);
  if (!rows.length || covered < Number(item.quantity)) return null;
  return { id: rows[0].id, status: rows[0].status };
}

module.exports = {
  findItemCoverage,
  DEFAULT_PROCUREMENT_HUB_REF,
  resolveProcurementHubRef,
  procurementHubLabel,
  requireSupplierMoney,
  loadExactSoldSku,
  resolveExactSkuProcurementReadiness,
  buildPurchaseTarget,
  insertHistoricalPurchaseLine,
  confirmHistoricalPurchaseLine,
};
