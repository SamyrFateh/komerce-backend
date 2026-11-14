/**
 * @komerce-arch
 * @role          market-delegation-local-stock-service
 * @domain        market-delegation
 * @layer         service
 * @criticality   high
 * @inputs        actor user, market code, product_id, relais_id, qty_received, proof_ref, Idempotency-Key
 * @outputs       local_stock_row, receipt_audit, exposure_row
 * @depends       services/local-stock-service.js, services/market-delegation-service.js, services/market-delegation-team-service.js
 * @db-read       products, relais, local_stock, market_delegation_audit
 * @db-write      none
 * @db-write-via:local-stock-service local_stock
 * @db-write-via:market-delegation-service market_delegation_audit
 * @db-txn        advisory_lock_session
 * @doctrine      country_lead_only_local_stock_declaration, market_pool_stock_km_main, no_second_stock_writer
 * @impact-areas  market-delegation, local-stock
 * @version       2026-11
 */
'use strict';

/**
 * Décision propriétaire (W3) : seul le responsable pays du marché (membership active avec la
 * capability local_offer.manage de l'offre locale) déclare une réception et décide de l'exposition.
 * Admin et tout autre rôle : 403. Stock en pool par marché (location KM_MAIN, lue par le checkout) ;
 * le relais de réception, le justificatif et la quantité sont tracés dans market_delegation_audit.
 * Aucun second writer : setLocalStock / setLocalStockExposure.
 */
const localStock = require('./local-stock-service');
const { audit } = require('./market-delegation-service');
const { resolveAuthorization } = require('./market-delegation-team-service');

const CAPABILITY = 'local_offer.manage';
const POOL_LOCATION = 'KM_MAIN';
const MAX_QTY = 1000000;

function err(code, message, status) {
  return Object.assign(new Error(message), { code, status });
}

async function authorize(db, { actorUserId, actorRole, marketCode }) {
  if (actorRole === 'admin') {
    throw err('LOCAL_STOCK_COUNTRY_LEAD_ONLY', 'Réservé au responsable pays du marché.', 403);
  }
  return resolveAuthorization(db, { userId: actorUserId, marketCode, requiredCapability: CAPABILITY });
}

async function listMarketStock(db, { actorUserId, actorRole, marketCode }) {
  const authz = await authorize(db, { actorUserId, actorRole, marketCode });
  const { rows } = await db.query(
    `SELECT ls.product_id, p.name, ls.location, ls.qty_physical, ls.commercial_exposure, ls.updated_at
       FROM local_stock ls JOIN products p ON p.id = ls.product_id
      WHERE ls.market_id = $1::uuid ORDER BY ls.updated_at DESC LIMIT 200`,
    [authz.market_id]
  );
  const relais = await db.query(
    `SELECT id, name FROM relais WHERE market_id = $1::uuid AND is_active = TRUE ORDER BY name`,
    [authz.market_id]
  );
  return { authz, stock: rows, relais: relais.rows };
}

async function declareReceipt(db, {
  actorUserId, actorRole, marketCode, productId, relaisId, qtyReceived, proofRef, note = null, idempotencyKey,
}) {
  const authz = await authorize(db, { actorUserId, actorRole, marketCode });
  if (!idempotencyKey || String(idempotencyKey).length > 200) {
    throw err('LOCAL_STOCK_IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key requis.', 400);
  }
  if (!Number.isInteger(qtyReceived) || qtyReceived <= 0 || qtyReceived > MAX_QTY) {
    throw err('LOCAL_STOCK_QTY_INVALID', 'qty_received doit être un entier > 0.', 400);
  }
  const proof = String(proofRef || '').trim();
  if (!proof || proof.length > 200) throw err('LOCAL_STOCK_PROOF_REQUIRED', 'proof_ref obligatoire (200 caractères max).', 400);
  if (!productId || !relaisId) throw err('LOCAL_STOCK_FIELDS_REQUIRED', 'product_id et relais_id requis.', 400);
  const cleanNote = note == null ? null : String(note).slice(0, 500);

  const { rows: [relais] } = await db.query(
    'SELECT id, market_id FROM relais WHERE id = $1 AND is_active = TRUE', [relaisId]);
  if (!relais || String(relais.market_id) !== String(authz.market_id)) {
    throw err('LOCAL_STOCK_RELAIS_MARKET_MISMATCH', 'Relais inconnu, inactif ou hors de ce marché.', 422);
  }
  const { rows: [product] } = await db.query('SELECT id, is_active FROM products WHERE id = $1', [productId]);
  if (!product) throw err('LOCAL_STOCK_PRODUCT_NOT_FOUND', 'Produit introuvable.', 404);
  if (!product.is_active) throw err('LOCAL_STOCK_PRODUCT_INACTIVE', 'Produit inactif : réception refusée.', 422);

  // Verrou advisory de session (setLocalStock écrit via le pool) : sérialise rejeu + lecture/écriture du pool.
  const lockKey = `local_stock_receipt:${authz.market_id}:${productId}`;
  await db.query('SELECT pg_advisory_lock(hashtext($1))', [lockKey]);
  try {
    const { rows: [prior] } = await db.query(
      `SELECT payload_after FROM market_delegation_audit
        WHERE market_id = $1::uuid AND action = 'LOCAL_STOCK_RECEIPT' AND correlation_id = $2 LIMIT 1`,
      [authz.market_id, idempotencyKey]
    );
    if (prior) return { replayed: true, ...prior.payload_after };

    const before = await localStock.getLocalStock(productId, authz.market_id, POOL_LOCATION);
    const previousQty = before ? Number(before.qty_physical) : 0;
    const row = await localStock.setLocalStock({
      productId, marketId: authz.market_id, location: POOL_LOCATION,
      qtyPhysical: previousQty + qtyReceived, actorUserId,
    });
    const result = {
      product_id: productId, relais_id: relaisId, qty_received: qtyReceived, proof_ref: proof, note: cleanNote,
      location: POOL_LOCATION, qty_before: previousQty, qty_after: Number(row.qty_physical),
    };
    await audit(db, {
      actorUserId, marketId: authz.market_id, assignmentId: authz.assignment_id, membershipId: authz.membership_id,
      capability: CAPABILITY, action: 'LOCAL_STOCK_RECEIPT',
      before: { qty_physical: previousQty }, after: result, correlationId: idempotencyKey,
    });
    return { replayed: false, ...result, stock: row };
  } finally {
    await db.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]).catch(() => {});
  }
}

async function setExposure(db, { actorUserId, actorRole, marketCode, productId, exposure, correlationId = null }) {
  const authz = await authorize(db, { actorUserId, actorRole, marketCode });
  if (!['ENABLED', 'DISABLED'].includes(exposure)) {
    throw err('LOCAL_STOCK_EXPOSURE_INVALID', 'commercial_exposure doit valoir ENABLED ou DISABLED.', 400);
  }
  const before = await localStock.getLocalStock(productId, authz.market_id, POOL_LOCATION);
  if (!before) throw err('LOCAL_STOCK_NOT_FOUND', 'Aucun stock local déclaré pour ce produit.', 404);
  const row = await localStock.setLocalStockExposure(productId, authz.market_id, exposure, POOL_LOCATION);
  await audit(db, {
    actorUserId, marketId: authz.market_id, assignmentId: authz.assignment_id, membershipId: authz.membership_id,
    capability: CAPABILITY, action: exposure === 'ENABLED' ? 'LOCAL_STOCK_EXPOSED' : 'LOCAL_STOCK_HIDDEN',
    before: { commercial_exposure: before.commercial_exposure }, after: { product_id: productId, commercial_exposure: row.commercial_exposure },
    correlationId,
  });
  return row;
}

module.exports = { declareReceipt, setExposure, listMarketStock, POOL_LOCATION, CAPABILITY };
