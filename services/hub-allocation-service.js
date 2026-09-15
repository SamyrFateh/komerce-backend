/**
 * @komerce-arch
 * @role          inventory-hub-allocation-service
 * @domain        inventory
 * @layer         service
 * @criticality   critical
 * @inputs        caller_owned_executor, order_item_id, optional purchase_order_id, parcel_id
 * @outputs       proven physical allocation context / compatibility verdict
 * @depends       none
 * @used-by       services/inventory-service.js, services/hub-operations.js
 * @db-read       inventory_items, order_items, orders, purchase_orders, parcels, parcel_items, relais
 * @db-write      none
 * @db-txn        caller_transaction_preserved
 * @doctrine      HUB-001_PHYSICAL_IDENTITY_ALLOCATION_CUSTODY
 * @impact-areas  inventory, logistics, purchasing, orders
 * @version       2026-09
 */
'use strict';

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('hub-allocation-service requires an executor exposing query(sql, params)');
  }
  return executor;
}

function hubAllocationError(code, message, details = {}) {
  const err = new Error(message || code);
  err.code = code;
  err.details = details;
  return err;
}

function assertPositiveQuantity(quantity) {
  const q = Number(quantity == null ? 1 : quantity);
  if (!Number.isInteger(q) || q <= 0) {
    throw hubAllocationError('HUB_INVALID_PHYSICAL_QUANTITY', 'La quantité physique doit être un entier strictement positif.', { quantity });
  }
  return q;
}

function hasExactSupplierIdentity(po) {
  if (!po || !po.product_sku_id || !po.supplier_unit_ref || !po.supplier_order_identity) return false;
  const identity = typeof po.supplier_order_identity === 'string'
    ? (() => { try { return JSON.parse(po.supplier_order_identity); } catch (_) { return null; } })()
    : po.supplier_order_identity;
  return !!(
    identity && typeof identity === 'object' &&
    typeof identity.provider === 'string' && identity.provider.trim() &&
    Number.isInteger(Number(identity.version)) && Number(identity.version) >= 1 &&
    identity.payload && typeof identity.payload === 'object' && Object.keys(identity.payload).length > 0
  );
}

/**
 * Résout l'allocation d'achat exacte d'une ligne commerciale.
 *
 * - purchase_order_id explicite : il DOIT appartenir à l'order_item.
 * - absent : résolution seulement si EXACTEMENT une PO active existe.
 * - 0 ou >1 : fail-closed, jamais de choix heuristique.
 * - pour une ligne SKU, la PO doit porter la même product_sku_id + SOI exacte.
 *
 * Les lignes PO candidates sont verrouillées pour sérialiser une réception
 * concurrente sur la même allocation d'achat.
 */
async function resolvePurchaseAllocation(executor, {
  orderItemId,
  purchaseOrderId = null,
  quantity = 1,
}) {
  const db = requireExecutor(executor);
  const physicalQuantity = assertPositiveQuantity(quantity);

  const { rows: [item] } = await db.query(`
    SELECT oi.id AS order_item_id,
           oi.order_id,
           oi.product_id,
           oi.sku_id,
           oi.quantity AS ordered_quantity,
           oi.fulfillment_source,
           o.market_id,
           o.relais_id
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
     WHERE oi.id = $1
  `, [orderItemId]);

  if (!item) {
    throw hubAllocationError('HUB_ORDER_ITEM_NOT_FOUND', 'Article de commande introuvable.', { order_item_id: orderItemId });
  }

  if (item.fulfillment_source === 'LOCAL_STOCK') {
    throw hubAllocationError(
      'HUB_LOCAL_STOCK_NOT_PROCUREMENT',
      'Une ligne LOCAL_STOCK ne peut pas être reçue comme allocation fournisseur au Procurement Hub.',
      { order_item_id: item.order_item_id }
    );
  }

  const params = [item.order_item_id];
  let explicitClause = '';
  if (purchaseOrderId) {
    params.push(purchaseOrderId);
    explicitClause = 'AND po.id = $2';
  }

  const { rows: candidates } = await db.query(`
    SELECT po.id AS purchase_order_id,
           po.order_id AS purchase_order_order_id,
           po.order_item_id AS purchase_order_item_id,
           po.product_sku_id,
           po.supplier_id,
           po.product_supplier_id,
           po.supplier_sku,
           po.supplier_unit_ref,
           po.supplier_order_identity,
           po.qty AS purchase_quantity,
           po.status AS purchase_status
      FROM purchase_orders po
     WHERE po.order_item_id = $1
       AND po.status <> 'cancelled'
       ${explicitClause}
     ORDER BY po.created_at ASC, po.id ASC
     FOR UPDATE
  `, params);

  if (candidates.length !== 1) {
    const code = candidates.length === 0
      ? 'HUB_PURCHASE_ALLOCATION_NOT_FOUND'
      : 'HUB_PURCHASE_ALLOCATION_AMBIGUOUS';
    throw hubAllocationError(
      code,
      candidates.length === 0
        ? 'Aucune Purchase Order active ne prouve cette allocation physique.'
        : 'Plusieurs Purchase Orders actives existent : purchase_order_id explicite requis.',
      { order_item_id: item.order_item_id, purchase_order_id: purchaseOrderId, candidates: candidates.map((p) => p.purchase_order_id) }
    );
  }

  const po = candidates[0];
  if (String(po.purchase_order_order_id) !== String(item.order_id) || String(po.purchase_order_item_id) !== String(item.order_item_id)) {
    throw hubAllocationError('HUB_PURCHASE_ALLOCATION_CONFLICT', 'La Purchase Order ne correspond pas à la ligne/commande commerciale.', {
      order_item_id: item.order_item_id,
      order_id: item.order_id,
      purchase_order_id: po.purchase_order_id,
    });
  }

  if (item.sku_id) {
    if (String(po.product_sku_id || '') !== String(item.sku_id) || !hasExactSupplierIdentity(po)) {
      throw hubAllocationError('HUB_SUPPLIER_IDENTITY_UNPROVEN', 'La Purchase Order ne prouve pas l’unité fournisseur exacte du SKU vendu.', {
        order_item_id: item.order_item_id,
        sku_id: item.sku_id,
        purchase_order_id: po.purchase_order_id,
        purchase_order_product_sku_id: po.product_sku_id || null,
      });
    }
  }

  const purchaseQuantity = Number(po.purchase_quantity || 0);
  if (!Number.isInteger(purchaseQuantity) || purchaseQuantity <= 0) {
    throw hubAllocationError('HUB_PURCHASE_QUANTITY_INVALID', 'La quantité de la Purchase Order est invalide.', {
      purchase_order_id: po.purchase_order_id,
      purchase_quantity: po.purchase_quantity,
    });
  }

  const { rows: [received] } = await db.query(`
    SELECT COALESCE(SUM(quantity), 0)::int AS received_quantity
      FROM inventory_items
     WHERE purchase_order_id = $1
       AND status <> 'cancelled'
  `, [po.purchase_order_id]);

  const alreadyReceived = Number(received && received.received_quantity || 0);
  if (alreadyReceived + physicalQuantity > purchaseQuantity) {
    throw hubAllocationError('HUB_RECEIPT_OVER_PURCHASE_QUANTITY', 'La réception dépasserait la quantité achetée.', {
      purchase_order_id: po.purchase_order_id,
      purchase_quantity: purchaseQuantity,
      already_received: alreadyReceived,
      attempted_quantity: physicalQuantity,
    });
  }

  return {
    ...item,
    ...po,
    physical_quantity: physicalQuantity,
    already_received_quantity: alreadyReceived,
    remaining_purchase_quantity: purchaseQuantity - alreadyReceived,
    identity_strength: item.sku_id ? 'EXACT_SUPPLIER_UNIT' : 'EXACT_PURCHASE_ORDER',
  };
}

/**
 * Vérifie qu'un contenant physique est compatible avec l'allocation.
 * La compatibilité est volontairement plus stricte que "même île" : même
 * relais canonique, donc même Market (F1 garantit order↔relay).
 *
 * Plusieurs commandes peuvent partager le colis si elles ont le même relais.
 */
async function assertParcelCompatible(executor, { parcelId, allocation }) {
  const db = requireExecutor(executor);
  if (!allocation || !allocation.order_item_id || !allocation.market_id || !allocation.relais_id) {
    throw hubAllocationError('HUB_ALLOCATION_CONTEXT_INCOMPLETE', 'Contexte d’allocation physique incomplet.');
  }

  const { rows: [parcel] } = await db.query(`
    SELECT p.id,
           p.reference,
           p.status,
           p.order_id AS anchor_order_id,
           p.relais_id,
           r.market_id AS parcel_market_id
      FROM parcels p
      LEFT JOIN relais r ON r.id = p.relais_id
     WHERE p.id = $1
     FOR UPDATE OF p
  `, [parcelId]);

  if (!parcel) {
    throw hubAllocationError('HUB_PARCEL_NOT_FOUND', 'Colis introuvable.', { parcel_id: parcelId });
  }
  if (!['draft', 'preparation'].includes(parcel.status)) {
    throw hubAllocationError('HUB_PARCEL_NOT_OPEN', 'Le colis n’est plus modifiable pour une allocation physique.', {
      parcel_id: parcel.id,
      status: parcel.status,
    });
  }
  if (!parcel.relais_id || !parcel.parcel_market_id) {
    throw hubAllocationError('HUB_PARCEL_DESTINATION_UNPROVEN', 'Le colis ne possède pas de destination canonique Market/Relais prouvée.', {
      parcel_id: parcel.id,
    });
  }
  if (String(parcel.relais_id) !== String(allocation.relais_id)) {
    throw hubAllocationError('HUB_DESTINATION_REASSIGNMENT_FORBIDDEN', 'Cette allocation appartient à un autre relais : réassignation interdite.', {
      parcel_id: parcel.id,
      parcel_relais_id: parcel.relais_id,
      allocation_relais_id: allocation.relais_id,
    });
  }
  if (String(parcel.parcel_market_id) !== String(allocation.market_id)) {
    throw hubAllocationError('HUB_MARKET_REASSIGNMENT_FORBIDDEN', 'Cette allocation appartient à un autre Market : réassignation interdite.', {
      parcel_id: parcel.id,
      parcel_market_id: parcel.parcel_market_id,
      allocation_market_id: allocation.market_id,
    });
  }

  const { rows: [membership] } = await db.query(`
    SELECT COUNT(DISTINCT o.market_id)::int AS market_count,
           COUNT(DISTINCT o.relais_id)::int AS relais_count,
           BOOL_AND(o.market_id = $2::uuid) AS all_same_market,
           BOOL_AND(o.relais_id = $3::uuid) AS all_same_relais
      FROM parcel_items pi
      JOIN order_items oi ON oi.id = pi.order_item_id
      JOIN orders o ON o.id = oi.order_id
     WHERE pi.parcel_id = $1
  `, [parcel.id, allocation.market_id, allocation.relais_id]);

  if (membership && Number(membership.market_count || 0) > 0) {
    if (Number(membership.market_count) !== 1 || membership.all_same_market !== true) {
      throw hubAllocationError('HUB_PARCEL_MARKET_CONFLICT', 'Le colis contient déjà des allocations de Market incompatibles.', { parcel_id: parcel.id });
    }
    if (Number(membership.relais_count) !== 1 || membership.all_same_relais !== true) {
      throw hubAllocationError('HUB_PARCEL_DESTINATION_CONFLICT', 'Le colis contient déjà des allocations de destination incompatibles.', { parcel_id: parcel.id });
    }
  }

  return parcel;
}

/**
 * Gate final d'expédition : la composition du colis doit rester homogène et
 * toute ligne IMPORT doit être couverte par une allocation physique prouvée.
 */
async function assertParcelPhysicalReadiness(executor, parcelId) {
  const db = requireExecutor(executor);

  const { rows: [parcel] } = await db.query(`
    SELECT p.id, p.reference, p.relais_id, r.market_id AS parcel_market_id
      FROM parcels p
      LEFT JOIN relais r ON r.id = p.relais_id
     WHERE p.id = $1
     FOR UPDATE OF p
  `, [parcelId]);
  if (!parcel) throw hubAllocationError('HUB_PARCEL_NOT_FOUND', 'Colis introuvable.', { parcel_id: parcelId });
  if (!parcel.relais_id || !parcel.parcel_market_id) {
    throw hubAllocationError('HUB_PARCEL_DESTINATION_UNPROVEN', 'Destination canonique du colis non prouvée.', { parcel_id: parcelId });
  }

  const { rows: [composition] } = await db.query(`
    SELECT COUNT(DISTINCT o.market_id)::int AS market_count,
           COUNT(DISTINCT o.relais_id)::int AS relais_count,
           BOOL_AND(o.market_id = $2::uuid) AS all_same_market,
           BOOL_AND(o.relais_id = $3::uuid) AS all_same_relais
      FROM parcel_items pi
      JOIN order_items oi ON oi.id = pi.order_item_id
      JOIN orders o ON o.id = oi.order_id
     WHERE pi.parcel_id = $1
  `, [parcel.id, parcel.parcel_market_id, parcel.relais_id]);

  if (!composition || Number(composition.market_count || 0) !== 1 || composition.all_same_market !== true) {
    throw hubAllocationError('HUB_PARCEL_MARKET_CONFLICT', 'Un Market Parcel doit être homogène avant expédition.', { parcel_id: parcel.id });
  }
  if (Number(composition.relais_count || 0) !== 1 || composition.all_same_relais !== true) {
    throw hubAllocationError('HUB_PARCEL_DESTINATION_CONFLICT', 'Un Market Parcel doit avoir une destination homogène avant expédition.', { parcel_id: parcel.id });
  }

  const { rows: gaps } = await db.query(`
    SELECT pi.order_item_id,
           oi.fulfillment_source,
           SUM(COALESCE(pi.quantity, 1))::int AS parcel_quantity,
           COALESCE((
             SELECT SUM(ii.quantity)::int
               FROM inventory_items ii
              WHERE ii.parcel_id = $1
                AND ii.order_item_id = pi.order_item_id
                AND ii.purchase_order_id IS NOT NULL
                AND ii.identity_verified_at IS NOT NULL
                AND ii.status = 'assigned'
           ), 0) AS proven_physical_quantity
      FROM parcel_items pi
      JOIN order_items oi ON oi.id = pi.order_item_id
     WHERE pi.parcel_id = $1
     GROUP BY pi.order_item_id, oi.fulfillment_source
  `, [parcel.id]);

  for (const gap of gaps || []) {
    // Local stock has its own physical ownership model. IMPORT must be proven
    // through the Procurement Hub. NULL remains historical/unknown and is
    // intentionally not silently reclassified as IMPORT.
    if (gap.fulfillment_source === 'IMPORT' && Number(gap.proven_physical_quantity || 0) < Number(gap.parcel_quantity || 0)) {
      throw hubAllocationError('HUB_PHYSICAL_ALLOCATION_INCOMPLETE', 'Le colis contient une quantité IMPORT non couverte par une allocation physique prouvée.', {
        parcel_id: parcel.id,
        order_item_id: gap.order_item_id,
        parcel_quantity: Number(gap.parcel_quantity || 0),
        proven_physical_quantity: Number(gap.proven_physical_quantity || 0),
      });
    }
  }

  return { ready: true, parcel_id: parcel.id, market_id: parcel.parcel_market_id, relais_id: parcel.relais_id };
}

module.exports = {
  assertPositiveQuantity,
  hasExactSupplierIdentity,
  resolvePurchaseAllocation,
  assertParcelCompatible,
  assertParcelPhysicalReadiness,
  hubAllocationError,
};
