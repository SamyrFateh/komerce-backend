/**
 * @komerce-arch
 * @role          hub
 * @domain        logistics
 * @layer         route
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, middleware/require-market-delegated-role.js, middleware/require-market-delegated-capability.js, services/hub-operations.js, services/hub-box-shipment-service.js
 * @used-by       bootstrap/api-routes.js
 * @db-read       orders, parcel_items, parcels, users, markets, market_operating_assignments, assignment_memberships, membership_capabilities, assignment_capability_ceiling
 * @db-write      none
 * @db-txn        service_owned
 * @doctrine      HUB-001 Physical Identity, Allocation & Custody; HUB-002 Operator Execution Cutover; capability_is_the_authority_not_role; central_hub_roles_remain_global
 * @impact-areas  logistics, market
 * @version       2026-10-d4
 */

/**
 * KOMERCE — Hub Terrain API
 *
 * Mutation canonique HUB-002 :
 * POST /api/hub/scan         → legacy fail-closed (410)
 * POST /api/hub/unit         → crée HANDLING_UNIT / MARKET_PARCEL
 * POST /api/hub/transition   → avance d'une étape du cycle physique
 * POST /api/hub/move         → SPLIT / MERGE / REPACK d'une allocation
 * POST /api/hub/revalidate   → sortie de quarantaine après vérité upstream + F3
 * POST /api/hub/outcome      → LOST/STOLEN/DESTROYED/DAMAGED_UNUSABLE
 * POST /api/hub/pack         → MARKET_PARCEL PICKED → PACKED
 * POST /api/hub/seal         → MARKET_PARCEL PACKED → DISPATCHED
 * POST/DELETE /api/hub/box/:unit_id/shipment → rattacher/détacher une KOM-BOX d'une expédition internationale du même marché
 * POST /api/hub/batch-scan   → legacy fail-closed (410)
 *
 * La réception fournisseur canonique est POST /api/scans/hub/receive.
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { attachMarketDelegatedRoleFor } = require('../middleware/require-market-delegated-role');
const denyTransitaireHub = require('../middleware/deny-transitaire-hub');
const { attachAuthorizedMarketsForCapability } = require('../middleware/require-market-delegated-capability');
const { validate } = require('../middleware/validate');
const { hub } = require('../validators');
const hubOps  = require('../services/hub-operations');
const boxShipment = require('../services/hub-box-shipment-service');
const physicalCodes = require('../services/hub-physical-codes');
const { listAuthorizedMarketsForCapability } = require('../services/market-delegation-service');
const uploadHub = require('../middleware/upload-hub');

const hubAuth = [authenticate, requireRole(['admin', 'agent_hub'])];
const attachOperationsReadMarkets = attachAuthorizedMarketsForCapability('operations.read', { audit: false });

function attachHubReadAuthority(req, res, next) {
  if (!req.user || req.user.role !== 'market_operator') return next();
  return attachOperationsReadMarkets(req, res, next);
}

const hubRead = [
  authenticate,
  denyTransitaireHub,
  attachMarketDelegatedRoleFor(['admin', 'agent_hub', 'market_operator']),
  requireRole(['admin', 'agent_hub', 'market_operator']),
  attachHubReadAuthority,
];

function addMarketScope(req, conditions, params, column = 'o.market_id') {
  if (req.user.role !== 'market_operator') return;
  conditions.push(`${column} = ANY($${params.length + 1}::uuid[])`);
  params.push(req.authorizedMarkets ? Array.from(req.authorizedMarkets) : []);
}

router.post('/scan', ...hubAuth, validate({ body: hub.scan }), async (req, res, next) => {
  try {
    const result = await hubOps.receiveParcel(req.body.parcel_ref, req.user.id, req.body.notes);
    res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});

// Identification d'une référence réellement scannée ; ne fait PAS la réception ni l'allocation client.
function sendPhysicalCodeError(err, res, next) {
  if (err instanceof physicalCodes.PhysicalCodeError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  return next(err);
}

router.get('/physical-codes/resolve', ...hubAuth, async (req, res, next) => {
  try {
    const result = await physicalCodes.resolvePhysicalCode(db, {
      purchaseOrderId: req.query.purchase_order_id,
      code: req.query.code,
    });
    return res.json(result);
  } catch (err) { return sendPhysicalCodeError(err, res, next); }
});

// L'agent confirme la référence imprimée ET la preuve visuelle de variante.
// La transaction protège l'apprentissage concurrent d'un code physique.
router.post('/physical-codes/confirm', ...hubAuth, async (req, res, next) => {
  let client;
  try {
    // Périmètre issu de la session : admin et Hub central non restreints ; un agent_hub porteur de délégations
    // marché actives (operations.read) est limité à ces marchés (403 et zéro mutation hors périmètre).
    let allowedMarketIds = null;
    if (req.user.role !== 'admin') {
      const grants = await listAuthorizedMarketsForCapability(db, { userId: req.user.id, requiredCapability: 'operations.read' });
      if (grants.length) allowedMarketIds = grants.map(row => row.market_id);
    }
    client = await db.connect();
    await client.query('BEGIN');
    const result = await physicalCodes.confirmPhysicalCode(client, {
      purchaseOrderId: req.body && req.body.purchase_order_id,
      productSkuId: req.body && req.body.product_sku_id,
      code: req.body && req.body.code,
      codeType: req.body && req.body.code_type,
      proofRef: req.body && req.body.proof_ref,
      actorId: req.user.id,
      allowedMarketIds,
    });
    await client.query('COMMIT');
    return res.status(201).json(result);
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) { /* keep original error */ }
    }
    return sendPhysicalCodeError(err, res, next);
  } finally {
    if (client) client.release();
  }
});

router.post('/unit', ...hubAuth, async (req, res, next) => {
  try {
    const result = await hubOps.createOperatorUnitCommand(req.body || {}, req.user.id);
    res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});

router.post('/transition', ...hubAuth, async (req, res, next) => {
  try {
    const result = await hubOps.transitionOperatorUnitCommand(req.body || {}, req.user.id);
    res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});

router.post('/move', ...hubAuth, async (req, res, next) => {
  try {
    const result = await hubOps.moveAllocationCommand(req.body || {}, req.user.id);
    res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});

router.post('/revalidate', ...hubAuth, async (req, res, next) => {
  try {
    const result = await hubOps.revalidateQuarantineCommand(req.body || {}, req.user.id);
    res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});

router.post('/outcome', ...hubAuth, async (req, res, next) => {
  try {
    const result = await hubOps.recordPhysicalOutcomeCommand(req.body || {}, req.user.id);
    res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});

router.post('/pack', ...hubAuth, validate({ body: hub.pack }), async (req, res, next) => {
  try {
    const { parcel_id, box_label, notes } = req.body;
    const result = await hubOps.packParcel(parcel_id, req.user.id, box_label, notes);
    res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});

router.post('/seal', ...hubAuth, validate({ body: hub.seal }), async (req, res, next) => {
  try {
    const { parcel_id, notes } = req.body;
    const result = await hubOps.sealParcel(parcel_id, req.user.id, notes);
    res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});

// KOM-BOX → expédition internationale du même marché (migration 358) : garde-fous en base.
function boxShipmentError(err, res, next) {
  if (err && err.status) return res.status(err.status).json({ error: err.message, code: err.code });
  return next(err);
}

router.post('/box/:unit_id/shipment', ...hubAuth, async (req, res, next) => {
  try {
    res.status(201).json(await boxShipment.attachBoxToShipment({
      unitId: req.params.unit_id, shipmentReference: (req.body || {}).shipment_reference, actor: req.user,
    }));
  } catch (err) { boxShipmentError(err, res, next); }
});

router.delete('/box/:unit_id/shipment', ...hubAuth, async (req, res, next) => {
  try { res.json(await boxShipment.detachBoxFromShipment({ unitId: req.params.unit_id, actor: req.user })); } catch (err) { boxShipmentError(err, res, next); }
});

// Dossier d'approvisionnement par marché : projection en lecture seule (aucune seconde source de vérité).
const dossier = require('../services/hub-procurement-dossier');
const globalHubBoard = require('../services/hub-global-board');
const administrationBoard = require('../services/hub-administration-board');

// Visibilité transverse en lecture seule pour tous les collaborateurs internes.
// Les écritures Hub demeurent strictement gardées par hubAuth et leurs services.
const HUB_VIEW_ROLES = Object.freeze([
  'admin', 'agent_hub', 'market_operator', 'agent_relais',
  'finance', 'sourcing', 'support',
]);
const hubBoardRead = [
  authenticate,
  denyTransitaireHub,
  attachMarketDelegatedRoleFor(HUB_VIEW_ROLES),
  // Explicit list retains Security 360's static proof of the allowed readers.
  requireRole(['admin', 'agent_hub', 'market_operator', 'agent_relais',
    'finance', 'sourcing', 'support']),
];

// The administrative financial/PO projection is NOT the all-role Hub board.
// Reading it never confers purchasing or payment-writing authority.
router.get('/administration', authenticate, requireRole(['admin', 'agent_hub']), async (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    return res.json(await administrationBoard.getAdministrationBoard(undefined, undefined, req.user && req.user.id));
  } catch (err) { return next(err); }
});

// Vue directrice (#3998 H4) : tâches du dossier Hub de TOUS les marchés actifs, avec ancienneté et alerte au-delà de 48 h.
// Même service que le dossier par marché ; lecture seule, aucun droit d'écriture conféré.
router.get('/director-todo', authenticate, requireRole(['admin', 'agent_hub']), async (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    return res.json(await dossier.getDirectorTodo({ viewer: req.user || null }));
  } catch (err) { return next(err); }
});

router.get('/board', ...hubBoardRead, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    return res.json(await globalHubBoard.getGlobalBoard());
  } catch (err) { return next(err); }
});

function marketAllowed(req, marketId) {
  if (req.user.role !== 'market_operator') return true;
  return Boolean(req.authorizedMarkets && req.authorizedMarkets.has(marketId));
}

router.get('/dossier', ...hubRead, async (req, res, next) => {
  try {
    const market = await dossier.resolveMarket(req.query.market);
    if (!marketAllowed(req, market.id)) return res.status(403).json({ error: 'Marché non autorisé', code: 'HUB_MARKET_FORBIDDEN' });
    const supplierId = req.query.supplier_id ? String(req.query.supplier_id) : null;
    res.json({ market, ...(await dossier.getDossier({ marketId: market.id, supplierId })) });
  } catch (err) { boxShipmentError(err, res, next); }
});

router.get('/trace', ...hubRead, async (req, res, next) => {
  try {
    const allowed = req.user.role === 'market_operator'
      ? (req.authorizedMarkets ? Array.from(req.authorizedMarkets) : [])
      : null;
    res.json(await dossier.getTrace({
      orderId: req.query.order_id || null, purchaseOrderId: req.query.po_id || null, allowedMarketIds: allowed,
    }));
  } catch (err) { boxShipmentError(err, res, next); }
});

router.post('/volume', ...hubAuth, validate({ body: hub.volume }), async (req, res, next) => {
  try {
    const { product_id, volume_cm3, repack_volume_cm3 } = req.body;
    const result = await hubOps.recordVolume(product_id, req.user.id, { volume_cm3, repack_volume_cm3 });
    res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});

router.post('/photo', ...hubAuth, uploadHub.single('photo'), uploadHub.validateMagicBytes, async (req, res, next) => {
  const removeUploadedFile = () => {
    if (!req.file || !req.file.path) return;
    try { require('fs').unlinkSync(req.file.path); } catch (_) {}
  };

  try {
    if (!req.file) return res.status(400).json({ error: "Photo manquante (champ multipart 'photo')" });
    const { error, value } = hub.photo.validate({ parcel_id: req.body.parcel_id, notes: req.body.notes });
    if (error) {
      removeUploadedFile();
      return res.status(400).json({ error: error.details[0].message });
    }
    const photoUrl = uploadHub.PUBLIC_PREFIX + req.file.filename;
    const result = await hubOps.recordSealPhoto(value.parcel_id, req.user.id, photoUrl, value.notes || null);
    if (result.status >= 400) removeUploadedFile();
    res.status(result.status).json(result.body);
  } catch (err) {
    removeUploadedFile();
    next(err);
  }
});

router.post('/batch-scan', ...hubAuth, async (req, res, next) => {
  try {
    const result = await hubOps.batchScan(req.body && req.body.parcel_refs, req.user.id, req.body && req.body.notes);
    res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});

router.get('/search', ...hubRead, async (req, res, next) => {
  try {
    const { q, status, island, limit = 50, offset = 0 } = req.query;
    const conditions = ['1=1'];
    const params = [];
    let pi = 1;

    if (q) {
      conditions.push(`(p.reference ILIKE $${pi} OR o.reference ILIKE $${pi} OR u.full_name ILIKE $${pi})`);
      params.push(`%${q}%`);
      pi++;
    }
    if (status) {
      conditions.push(`p.status = $${pi}`);
      params.push(status);
      pi++;
    }
    if (island) {
      conditions.push(`o.destination_island = $${pi}`);
      params.push(island);
      pi++;
    }
    addMarketScope(req, conditions, params);
    pi = params.length + 1;
    const where = conditions.join(' AND ');

    const { rows } = await db.query(`
      SELECT p.id, p.reference, p.status, p.type, p.order_id, p.notes,
             p.created_at, p.updated_at,
             o.reference AS order_reference,
             o.destination_island, o.routing_mode, o.transit_hub,
             u.full_name AS client_name,
             (SELECT COUNT(*) FROM parcel_items pi2 WHERE pi2.parcel_id = p.id) AS items_count
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      LEFT JOIN users u ON u.id = o.user_id
      WHERE ${where}
      ORDER BY p.updated_at DESC
      LIMIT $${pi} OFFSET $${pi + 1}
    `, [...params, Number(limit), Number(offset)]);

    const { rows: [{ count }] } = await db.query(`
      SELECT COUNT(*) FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      LEFT JOIN users u ON u.id = o.user_id
      WHERE ${where}
    `, params);

    res.json({ data: rows, total: Number(count) });
  } catch (err) { next(err); }
});

router.get('/stats/week', ...hubRead, async (req, res, next) => {
  try {
    const conditions = ["p.created_at >= CURRENT_DATE - INTERVAL '7 days'"];
    const params = [];
    addMarketScope(req, conditions, params);
    const where = conditions.join(' AND ');

    const { rows } = await db.query(`
      SELECT
        DATE(p.created_at) AS day,
        COUNT(*) FILTER (WHERE p.status = 'preparation')   AS scanned,
        COUNT(*) FILTER (WHERE p.notes ILIKE '%[PACKED]%') AS packed,
        COUNT(*) FILTER (WHERE p.status = 'shipped')       AS sealed,
        COUNT(*)                                            AS total
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      WHERE ${where}
      GROUP BY DATE(p.created_at)
      ORDER BY day ASC
    `, params);

    const totalConditions = ['1=1'];
    const totalParams = [];
    addMarketScope(req, totalConditions, totalParams);
    const totalWhere = totalConditions.join(' AND ');
    const { rows: [totals] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE p.status IN ('draft', 'preparation')) AS pending,
        COUNT(*) FILTER (WHERE p.status = 'shipped'
                         AND p.shipped_at >= CURRENT_DATE)           AS shipped_today,
        AVG(EXTRACT(EPOCH FROM (p.shipped_at - p.prepared_at)) / 3600)
          FILTER (WHERE p.shipped_at IS NOT NULL
                  AND p.prepared_at IS NOT NULL
                  AND p.shipped_at >= CURRENT_DATE - INTERVAL '7 days')
          AS avg_processing_hours
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      WHERE ${totalWhere}
    `, totalParams);

    res.json({
      daily: rows,
      summary: {
        pending: Number(totals.pending || 0),
        shipped_today: Number(totals.shipped_today || 0),
        avg_processing_hours: totals.avg_processing_hours
          ? Math.round(Number(totals.avg_processing_hours) * 10) / 10
          : null,
      },
    });
  } catch (err) { next(err); }
});

router.get('/pending', ...hubRead, async (req, res, next) => {
  try {
    const conditions = ["p.status IN ('draft', 'preparation')"];
    const params = [];
    addMarketScope(req, conditions, params);
    const where = conditions.join(' AND ');
    const { rows } = await db.query(`
      SELECT p.id, p.reference, p.status, p.type, p.order_id, p.notes,
             p.created_at, p.updated_at,
             o.reference AS order_reference,
             o.destination_island, o.routing_mode, o.transit_hub,
             u.full_name AS client_name,
             (SELECT COUNT(*) FROM parcel_items pi WHERE pi.parcel_id = p.id) AS items_count
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      LEFT JOIN users u ON u.id = o.user_id
      WHERE ${where}
      ORDER BY p.created_at ASC
    `, params);
    res.json({ data: rows, count: rows.length });
  } catch (err) { next(err); }
});

router.get('/today', ...hubRead, async (req, res, next) => {
  try {
    const conditions = ['1=1'];
    const params = [];
    addMarketScope(req, conditions, params);
    const where = conditions.join(' AND ');
    const { rows } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE p.status = 'preparation'
                         AND p.prepared_at >= CURRENT_DATE)       AS scanned_today,
        COUNT(*) FILTER (WHERE p.notes ILIKE '%[PACKED]%'
                         AND p.updated_at >= CURRENT_DATE)        AS packed_today,
        COUNT(*) FILTER (WHERE p.status = 'shipped'
                         AND p.shipped_at >= CURRENT_DATE)        AS sealed_today,
        COUNT(*) FILTER (WHERE p.status IN ('draft', 'preparation')) AS pending_total
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      WHERE ${where}
    `, params);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
