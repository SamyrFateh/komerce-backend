/**
 * @komerce-arch
 * @role          canonical-operations-workspace-route
 * @domain        admin-dashboard
 * @layer         route
 * @criticality   high
 * @inputs        authenticated_operator, requested_market_code, workspace_action
 * @outputs       authorized_operations_workspace_projection, authorized_domain_mutations
 * @depends       db, middleware/auth, middleware/require-market-execution-capability, middleware/require-market-delegated-capability, middleware/require-dashboard-global-authority, services/operations-workspace
 * @used-by       bootstrap/api-routes.js
 * @db-read       markets, users, relais, market_operating_assignments, assignment_memberships, membership_capabilities, assignment_capability_ceiling, dashboard_global_access_grants, hub_physical_units, hub_physical_unit_placements, hub_purchase_allocations, hub_box_bags, orders, purchase_orders
 * @db-write      none
 * @db-txn        none
 * @doctrine      workspace_single_market_action_context, capability_is_market_authority, relay_binding_is_server_authority, client_market_id_forbidden, workspace_role_least_privilege
 * @impact-areas  admin-dashboard, logistics, inventory, orders, payments, market-authorization
 * @version       2026-10-d3
 */

'use strict';

const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { attachMarketExecutionRoleFor } = require('../middleware/require-market-execution-capability');
const { requireMarketDelegatedCapability } = require('../middleware/require-market-delegated-capability');
const { hasDashboardGlobalAuthority } = require('../middleware/require-dashboard-global-authority');
const workspace = require('../services/operations-workspace');
const supply = require('../services/hub-procurement-dossier');
const boxShipment = require('../services/hub-box-shipment-service');
const bagBox = require('../services/hub-bag-box-service');
const physicalIdentity = require('../services/hub-physical-identity');
const hubOps = require('../services/hub-operations');
const shipmentJourney = require('../services/international-shipment-journey');
const relayReceipts = require('../services/relay-shipment-receipt');
const log = require('../utils/logger').child({ module: 'admin-operations-workspace' });

const router = express.Router();
const MARKET_CODE = /^[A-Z]{2}$/;
// D3 : la capability borne la surface et le Market ID. La lecture est portée
// par operations.read ou par l'autorité dashboard globale explicite ; un
// agent_relais peut lire son propre marché via son rattachement relais serveur.
// users.role n'accorde aucun droit marché : les execution.* projettent ensuite
// un rôle de compatibilité request-local pour les moteurs historiques.
const requireHubWorkspaceAction = requireRole(['admin', 'agent_hub']);
const requireRelayWorkspaceAction = requireRole(['admin', 'agent_relais']);

function attachHubExecutionCapability(capability) {
  return attachMarketExecutionRoleFor({
    capability,
    compatibilityRole: 'agent_hub',
    forceCapability: true,
    centralRoles: ['agent_hub'],
  });
}

function attachRelayExecutionCapability(capability) {
  return attachMarketExecutionRoleFor({
    capability,
    compatibilityRole: 'agent_relais',
    forceCapability: true,
  });
}

function rejectClientMarketAuthority(req, res, next) {
  const query = req.query || {};
  const body = req.body || {};
  if (
    Object.prototype.hasOwnProperty.call(query, 'market_id') ||
    Object.prototype.hasOwnProperty.call(query, 'marketId') ||
    Object.prototype.hasOwnProperty.call(body, 'market_id') ||
    Object.prototype.hasOwnProperty.call(body, 'marketId')
  ) {
    return res.status(400).json({
      error: 'market_id client interdit — le marché est résolu depuis la route et les grants serveur',
      code: 'client_market_id_forbidden',
    });
  }
  return next();
}

async function resolveRequestedMarket(req, res, next) {
  const code = String(req.params.marketCode || '').trim().toUpperCase();
  if (!MARKET_CODE.test(code)) {
    return res.status(400).json({ error: 'Code marché invalide', code: 'invalid_market_code' });
  }

  try {
    const { rows } = await db.query(
      `SELECT id, code, name, currency, lifecycle_status
         FROM markets
        WHERE code = $1
          AND is_active = TRUE
        LIMIT 1`,
      [code]
    );
    if (!rows.length) {
      return res.status(404).json({
        error: 'Marché introuvable ou inactif',
        code: 'market_not_found',
      });
    }
    req.workspaceMarket = rows[0];
    return next();
  } catch (err) {
    return next(err);
  }
}

async function requireRelayMarketBinding(req, res, next) {
  try {
    const actorId = req.user && req.user.id;
    const marketId = req.workspaceMarket && req.workspaceMarket.id;
    const { rows } = await db.query(
      `SELECT u.id AS user_id, r.id AS relais_id, r.market_id
         FROM users u
         JOIN relais r ON r.id = u.relais_id
        WHERE u.id = $1
          AND r.market_id = $2
        LIMIT 1`,
      [actorId, marketId]
    );
    if (!rows.length) {
      return res.status(403).json({
        error: 'Le relais de l’agent ne correspond pas au marché sélectionné.',
        code: 'relay_actor_market_mismatch',
      });
    }
    req.relayMarketAuthority = rows[0];
    return next();
  } catch (err) {
    return next(err);
  }
}

function requireWorkspaceReadAccess(req, res, next) {
  if (req.user && req.user.role === 'agent_relais') {
    return requireRelayMarketBinding(req, res, next);
  }
  // Hub central : lecture de tout marché ACTIVE sans membership (le rôle ne confère aucun droit Admin ni marché).
  if (req.user && req.user.role === 'agent_hub' && req.workspaceMarket && req.workspaceMarket.lifecycle_status === 'ACTIVE') {
    req.workspaceCentralHub = true;
    return next();
  }
  return hasDashboardGlobalAuthority(req.user && req.user.id)
    .then(globalAllowed => {
      if (globalAllowed) {
        req.workspaceGlobalAuthority = true;
        return next();
      }
      return requireMarketDelegatedCapability('operations.read', { audit: false })(req, res, next);
    })
    .catch(next);
}

// Le Hub reste consultable en supervision via sa projection publique /api/hub/board.
 // Les détails achats/PO/fournisseurs et leurs traces ne sont pas une donnée
 // terrain du relais, même quand le relais appartient au même marché.
function requireHubSupplyReadAccess(req, res, next) {
  if (req.user && req.user.role === 'agent_relais') {
    return res.status(403).json({
      code: 'relay_hub_private_dossier_forbidden',
      error: 'Les dossiers achats du Hub ne sont pas accessibles à un relais',
    });
  }
  return requireWorkspaceReadAccess(req, res, next);
}

function requireRelayPhysicalMarket(req, res, next) {
  const persistedRole = req.user && (req.user.persisted_role || req.user.role);
  if (persistedRole !== 'agent_relais') return next();
  return requireRelayMarketBinding(req, res, next);
}

function actionActor(req) {
  return {
    id: req.user && req.user.id,
    role: req.user && req.user.role,
    full_name: req.user && req.user.full_name,
    email: req.user && req.user.email,
  };
}

function sendCashConfirmationResult(res, result) {
  return res.status(result.pending_second_approval ? 202 : 200).json({
    ok: !result.pending_second_approval,
    action: 'confirm_cash',
    result,
  });
}

function sendWorkspaceError(err, res, next) {
  if (err && err.code === '23514' && /^HUB_ORDER_BAG_[A-Z_]+/.test(String(err.message || ''))) {
    return res.status(409).json({error:'Contenu du sac non conforme',
      code:String(err.message).match(/^HUB_ORDER_BAG_[A-Z_]+/)[0]});
  }
  if (err instanceof workspace.OperationsWorkspaceError) {
    return res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
  if (err && Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: err.message, code: err.code || 'workspace_action_rejected' });
  }
  return next(err);
}

router.use(
  '/market/:marketCode',
  authenticate,
  rejectClientMarketAuthority,
  resolveRequestedMarket
);

// Les requireRole restent volontairement visibles dans les chaînes de routes :
// Security360 peut ainsi prouver statiquement la frontière admin/terrain, tandis
// que le middleware execution placé juste avant peut fournir le rôle compatible
// uniquement après preuve de la capability exacte.
router.get(
  '/market/:marketCode',
  requireWorkspaceReadAccess,
  async (req, res, next) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      const payload = await workspace.buildWorkspace({ market: req.workspaceMarket, viewer: req.user });
      return res.json(payload);
    } catch (err) {
      log.error({ err, market: req.workspaceMarket && req.workspaceMarket.code }, '[operations-workspace] read failed');
      return sendWorkspaceError(err, res, next);
    }
  }
);

// Hub P0 (#3247) — Approvisionnement : projection serveur du dossier du marché de la route (lecture seule) et
// rattachement d'un carton à une expédition. Même services que /api/hub/*, une seule autorité.
router.get(
  '/market/:marketCode/supply',
  requireHubSupplyReadAccess,
  async (req, res, next) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      const dossier = await supply.getDossier({ marketId: req.workspaceMarket.id, viewer: req.user || null });
      return res.json({ market: { id: req.workspaceMarket.id, code: req.workspaceMarket.code }, ...dossier });
    } catch (err) {
      return sendWorkspaceError(err, res, next);
    }
  }
);

router.get(
  '/market/:marketCode/supply/trace',
  requireHubSupplyReadAccess,
  async (req, res, next) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      return res.json(await supply.getTrace({
        orderId: req.query.order_id || null,
        purchaseOrderId: req.query.po_id || null,
        allowedMarketIds: [req.workspaceMarket.id],
      }));
    } catch (err) {
      return sendWorkspaceError(err, res, next);
    }
  }
);

// Scanner une référence fournisseur dans le poste de réception du marché.
// Aucun rattachement client ici : le code identifie seulement la variante exacte de la PO.
router.get(
  '/market/:marketCode/supply/physical-code',
  attachHubExecutionCapability('execution.parcel.receive'),
  requireHubWorkspaceAction,
  async (req, res, next) => {
    try {
      const purchaseOrderId = String(req.query.purchase_order_id || '');
      if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(purchaseOrderId)) {
        return res.status(400).json({ error: 'PO invalide', code: 'HUB_PHYSICAL_PO_INVALID' });
      }
      const { rows } = await db.query(
        'SELECT id FROM purchase_orders WHERE id=$1 AND market_id=$2 LIMIT 1',
        [purchaseOrderId, req.workspaceMarket.id]
      );
      if (!rows.length) return res.status(404).json({ error: 'PO absente de ce marché', code: 'HUB_PHYSICAL_PO_NOT_IN_MARKET' });
      // Import tardif : ce poste d'écran ne peut être activé qu'après le lot mapping #3330.
      const physicalCodes = require('../services/hub-physical-codes');
      const match = await physicalCodes.resolvePhysicalCode(db, {
        purchaseOrderId, code: req.query.code,
      });
      res.set('Cache-Control', 'private, no-store');
      return res.json(match);
    } catch (err) { return sendWorkspaceError(err, res, next); }
  }
);

// Identités QR opaques : la génération ne mute jamais réception, allocation ou custody.
// POST explicite pour l'émission stable ; GET d'impression/relecture strictement read-only.
const hubLabels = require('../services/hub-opaque-labels');
const {renderHubLabelPdf}=require('../services/hub-label-pdf');
router.post(
  '/market/:marketCode/labels/articles/:allocationId/issue',
  attachHubExecutionCapability('execution.parcel.receive'),
  requireHubWorkspaceAction,
  async (req,res,next)=>{
    try{
      const labels=await db.withTransaction(client=>hubLabels.issueArticleLabels(client,{
        allocationId:req.params.allocationId,marketId:req.workspaceMarket.id,actorId:req.user.id,
      }));
      res.set('Cache-Control','private, no-store');
      return res.status(201).json({ok:true,type:'ARTICLE',count:labels.length,
        labels:labels.map(l=>({alias:l.short_alias,unit_number:l.unit_number}))});
    }catch(err){return sendWorkspaceError(err,res,next);}
  }
);
router.post(
  '/market/:marketCode/labels/boxes/:unitId/issue',
  attachHubExecutionCapability('execution.parcel.ship'),
  requireHubWorkspaceAction,
  async(req,res,next)=>{
    try{
      const label=await db.withTransaction(client=>hubLabels.issueBoxLabel(client,{
        boxId:req.params.unitId,marketId:req.workspaceMarket.id,
        relaisId:req.body&&req.body.relais_id,actorId:req.user.id,
      }));
      res.set('Cache-Control','private, no-store');
      return res.status(201).json({ok:true,type:'COMBOX',alias:label.short_alias});
    }catch(err){return sendWorkspaceError(err,res,next);}
  }
);
async function renderProtectedHubLabels(req,res,next,type) {
  try {
    const labels=await hubLabels.listLabels(db,{
      targetType:type,targetId:req.params.id,marketId:req.workspaceMarket.id,
    });
    const html=await hubLabels.printHtml(db,{labels,
      marketCode:req.workspaceMarket.code,format:req.query.format||'thermal'});
    res.set('Cache-Control','private, no-store');
    res.set('X-Content-Type-Options','nosniff');
    res.set('Content-Security-Policy',"default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'");
    return res.type('html').send(html);
  }catch(err){return sendWorkspaceError(err,res,next);}
}
router.get(
  '/market/:marketCode/labels/articles/:id/print',
  attachHubExecutionCapability('execution.parcel.receive'),
  requireHubWorkspaceAction,
  async(req,res,next)=>renderProtectedHubLabels(req,res,next,'ARTICLE')
);
router.get(
  '/market/:marketCode/labels/boxes/:id/print',
  attachHubExecutionCapability('execution.parcel.ship'),
  requireHubWorkspaceAction,
  async(req,res,next)=>renderProtectedHubLabels(req,res,next,'COMBOX')
);
// Secure binary PDF for test printing or on-screen camera scans.
// The identity has already been issued; downloading never mutates Hub state.
async function renderProtectedHubLabelsPdf(req,res,next,type){
 try{
  const labels=await hubLabels.listLabels(db,{
   targetType:type,targetId:req.params.id,marketId:req.workspaceMarket.id,
  });
  const format=req.query.format||'a4';
  const data=await renderHubLabelPdf(db,{
   labels,marketCode:req.workspaceMarket.code,format,
  });
  res.set('Cache-Control','private, no-store');
  res.set('X-Content-Type-Options','nosniff');
  res.set('Content-Security-Policy',"default-src 'none'; base-uri 'none'; sandbox");
  res.set('Content-Disposition','attachment; filename="KOMERCE-'+type+'-'+req.workspaceMarket.code+'-'+format+'.pdf"');
  return res.status(200).type('pdf').send(data);
 }catch(err){return sendWorkspaceError(err,res,next);}
}
router.get(
 '/market/:marketCode/labels/articles/:id/pdf',
 attachHubExecutionCapability('execution.parcel.receive'),
 requireHubWorkspaceAction,
 async(req,res,next)=>renderProtectedHubLabelsPdf(req,res,next,'ARTICLE')
);
router.get(
 '/market/:marketCode/labels/boxes/:id/pdf',
 attachHubExecutionCapability('execution.parcel.ship'),
 requireHubWorkspaceAction,
 async(req,res,next)=>renderProtectedHubLabelsPdf(req,res,next,'COMBOX')
);
router.get(
  '/market/:marketCode/labels/resolve',
  attachHubExecutionCapability('execution.parcel.receive'),
  requireHubWorkspaceAction,
  async(req,res,next)=>{
    try{
      const result=await hubLabels.resolveLabel(db,{
        code:req.query.code,marketId:req.workspaceMarket.id,
      });
      res.set('Cache-Control','private, no-store');
      return res.json({ok:true,label:result});
    }catch(err){return sendWorkspaceError(err,res,next);}
  }
);
// Relais : résolution sous authentification + identité du relais du compte.
// Aucune entrée client ne peut sélectionner le relais d'un autre agent.
router.get(
  '/market/:marketCode/relay/labels/resolve',
  attachRelayExecutionCapability('execution.parcel.receive'),
  requireRole(['agent_relais']),
  async(req,res,next)=>{
    try{
      if(!req.user||!req.user.relais_id) return res.status(403).json({code:'HUB_LABEL_RELAY_SCOPE_REQUIRED'});
      const result=await hubLabels.resolveLabel(db,{
        code:req.query.code,marketId:req.workspaceMarket.id,relaisId:req.user.relais_id,
      });
      res.set('Cache-Control','private, no-store');
      return res.json({ok:true,label:result});
    }catch(err){return sendWorkspaceError(err,res,next);}
  }
);

// Composition des KOM-BOX depuis Hub Live : mêmes commandes canoniques que /api/hub/* (hub-operations), avec le marché
// du Workspace imposé côté serveur (allocation et contenu du carton doivent appartenir au marché).
async function boxScanMatches(q, scannedValue, box, marketId) {
  const scanned=String(scannedValue||'').trim().toUpperCase();
  if(scanned===String(box.reference).toUpperCase()) return true; // historical scanner compatibility
  if(!/^KQ1_[A-F0-9]{32}$/.test(scanned) && !/^[A-HJ-NP-Z2-9]{8}$/.test(scanned)) return false;
  try {
    const label=await hubLabels.resolveLabel(q,{code:scanned,marketId});
    return label.target_type==='COMBOX' && String(label.physical_unit_id)===String(box.id);
  } catch(error) {
    if(error instanceof hubLabels.LabelError) return false;
    throw error;
  }
}
async function boxMarketGuard(unitId, marketId, allocationId) {
  const { rows: [unit] } = await db.query(`SELECT unit_type, reference FROM hub_physical_units WHERE id = $1`, [unitId]);
  if (!unit || unit.unit_type !== 'MARKET_PARCEL') return { status: 404, body: { error: 'KOM-BOX introuvable', code: 'BOX_NOT_FOUND' } };
  const { rows: foreign } = await db.query(
    `SELECT 1 FROM hub_physical_unit_placements p JOIN hub_purchase_allocations a ON a.id = p.allocation_id
      WHERE p.physical_unit_id = $1 AND p.removed_at IS NULL AND a.market_id <> $2 LIMIT 1`, [unitId, marketId]);
  if (foreign.length) return { status: 403, body: { error: 'KOM-BOX d’un autre marché', code: 'BOX_MARKET_MISMATCH' } };
  if (allocationId) {
    const { rows: own } = await db.query(
      `SELECT 1 FROM hub_purchase_allocations WHERE id = $1 AND market_id = $2`, [allocationId, marketId]);
    if (!own.length) return { status: 403, body: { error: 'Allocation d’un autre marché', code: 'ALLOCATION_MARKET_MISMATCH' } };
    const { rows: mismatch } = await db.query(
      `SELECT 1 FROM hub_scan_labels l
       JOIN hub_purchase_allocations a ON a.id=$2
       JOIN orders o ON o.id=a.order_id
       WHERE l.physical_unit_id=$1 AND l.target_type='COMBOX'
         AND (l.market_id<>a.market_id OR l.relais_id<>o.relais_id) LIMIT 1`,
      [unitId, allocationId]
    );
    if (mismatch.length) return { status: 409, body: {
      error:'Article destiné à un autre relais',code:'HUB_LABEL_BOX_RELAY_MISMATCH'
    }};
  }
  return null;
}

router.post(
  '/market/:marketCode/boxes',
  attachHubExecutionCapability('execution.parcel.ship'),
  requireHubWorkspaceAction,
  async (req, res, next) => {
    try {
      const body = req.body || {};
      // A2 : un rejeu après coupure renvoie la même KOM-BOX ; la clé est portée par le marché.
      const out = await hubOps.createOperatorUnitCommand({
        unit_type: 'MARKET_PARCEL', ...(body.reference ? { reference: body.reference } : {}),
      }, req.user.id, {
        idempotencyKey: req.get('Idempotency-Key') || '',
        idempotencyScope: req.workspaceMarket.id,
      });
      return res.status(out.status).json(out.body);
    } catch (err) { return sendWorkspaceError(err, res, next); }
  }
);

router.post(
  '/market/:marketCode/boxes/:unitId/fill',
  attachHubExecutionCapability('execution.parcel.ship'),
  requireHubWorkspaceAction,
  async (req, res, next) => {
    try {
      const body = req.body || {};
      const refused = await boxMarketGuard(req.params.unitId, req.workspaceMarket.id, body.allocation_id);
      if (refused) return res.status(refused.status).json(refused.body);
      const { rows: [box] } = await db.query('SELECT id,reference FROM hub_physical_units WHERE id=$1', [req.params.unitId]);
      if (!await boxScanMatches(db,body.box_reference_scan,box,req.workspaceMarket.id)) {
        return res.status(409).json({ error: 'Scannez la référence ou le QR de la COMBOX cible', code: 'HUB_BOX_SCAN_MISMATCH' });
      }
      if (!['SCAN','MANUAL'].includes(String(body.evidence_method || '').trim().toUpperCase())) {
        return res.status(400).json({ error: 'Le scan article ou sa preuve manuelle est obligatoire', code: 'HUB_BOX_ITEM_EVIDENCE_REQUIRED' });
      }
      const out = await hubOps.moveAllocationCommand({
        from_unit_id: body.from_unit_id, to_unit_id: req.params.unitId, allocation_id: body.allocation_id,
        quantity: body.quantity, operation_type: 'REPACK',
        evidence_method: body.evidence_method, evidence_code: body.evidence_code, evidence_ref: body.evidence_ref,
      }, req.user.id);
      return res.status(out.status).json(out.body);
    } catch (err) { return sendWorkspaceError(err, res, next); }
  }
);

router.post(
  '/market/:marketCode/boxes/:unitId/close',
  attachHubExecutionCapability('execution.parcel.ship'),
  requireHubWorkspaceAction,
  async (req, res, next) => {
    try {
      const refused = await boxMarketGuard(req.params.unitId, req.workspaceMarket.id, null);
      if (refused) return res.status(refused.status).json(refused.body);
      const body = req.body || {};
      const result = await db.withTransaction(async client => {
        const { rows: [box] } = await client.query(
          "SELECT id, reference, state FROM hub_physical_units WHERE id=$1 AND unit_type='MARKET_PARCEL' FOR UPDATE",
          [req.params.unitId]
        );
        if (!box) throw Object.assign(new Error('COMBOX introuvable'), { status: 404, code: 'BOX_NOT_FOUND' });
        if (!await boxScanMatches(client,body.box_reference_scan,box,req.workspaceMarket.id)) {
          throw Object.assign(new Error('Scannez la référence ou le QR de la COMBOX'), { status: 409, code: 'HUB_BOX_SCAN_MISMATCH' });
        }
        if (box.state === 'PACKED') return { id: box.id, state: box.state, already_closed: true };
        const sequence = ['RECEIVED','IDENTIFIED','QUALITY_CHECKED','LOCATED','ALLOCATED','PICKED','PACKED'];
        if (!sequence.includes(box.state)) throw Object.assign(new Error('COMBOX non fermable'), { status: 409, code: 'HUB_BOX_NOT_CLOSABLE' });
        const { rows: [contents] } = await client.query(
          'SELECT COUNT(*)::integer AS count FROM hub_physical_unit_placements WHERE physical_unit_id=$1 AND removed_at IS NULL',
          [box.id]
        );
        if (Number(contents.count) < 1) throw Object.assign(new Error('COMBOX vide'), { status: 409, code: 'HUB_BOX_EMPTY' });
        for (let i = sequence.indexOf(box.state) + 1; i < sequence.length; i++) {
          await physicalIdentity.transitionPhysicalUnit(client, {
            unitId: box.id, toState: sequence[i], actorId: req.user.id,
            details: { operator_action: 'close_combox' },
          });
        }
        return { id: box.id, state: 'PACKED', already_closed: false };
      });
      return res.json(result);
    } catch (err) { return sendWorkspaceError(err, res, next); }
  }
);

// Doctrine COMBOX directe : la surface d'écriture de sac client est RETIRÉE.
// Les URL historiques restent reconnues avec refus 410 explicite pour éviter
// qu'un ancien client/scripteur réactive une entité logistique abandonnée.
// Les lectures authentifiées des anciens sacs sont conservées en aval pour audit.
function refuseRetiredCustomerBag(_req, res) {
  res.set('Cache-Control', 'private, no-store');
  return res.status(410).json({
    code: 'HUB_CUSTOMER_BAG_RETIRED',
    error: 'Les sacs clients numériques sont supprimés : utiliser directement une COMBOX.',
  });
}

router.post(
  '/market/:marketCode/bags',
  attachHubExecutionCapability('execution.parcel.ship'),
  requireHubWorkspaceAction,
  async (req, res) => refuseRetiredCustomerBag(req, res)
);

router.post(
  '/market/:marketCode/bags/:unitId/deposit',
  attachHubExecutionCapability('execution.parcel.ship'),
  requireHubWorkspaceAction,
  async (req, res) => refuseRetiredCustomerBag(req, res)
);

router.post(
  '/market/:marketCode/bags/:unitId/close',
  attachHubExecutionCapability('execution.parcel.ship'),
  requireHubWorkspaceAction,
  async (req, res) => refuseRetiredCustomerBag(req, res)
);

router.post(
  '/market/:marketCode/boxes/:unitId/bags',
  attachHubExecutionCapability('execution.parcel.ship'),
  requireHubWorkspaceAction,
  async (req, res) => refuseRetiredCustomerBag(req, res)
);

router.post(
  '/market/:marketCode/boxes/:unitId/advance',
  attachHubExecutionCapability('execution.parcel.ship'),
  requireHubWorkspaceAction,
  async (req, res, next) => {
    try {
      const refused = await boxMarketGuard(req.params.unitId, req.workspaceMarket.id, null);
      if (refused) return res.status(refused.status).json(refused.body);
      const body=req.body||{};
      const out = await hubOps.transitionOperatorUnitCommand({
        unit_id:req.params.unitId,to_state:body.to_state,
        details:{box_qr_scan:body.box_qr_scan,label_applied_confirmed:body.label_applied_confirmed},
      },req.user.id);
      return res.status(out.status).json(out.body);
    } catch (err) { return sendWorkspaceError(err, res, next); }
  }
);

// Création d'un dossier d'expédition internationale directement depuis des KOM-BOX (service métier unique :
// international-shipment-journey) ; la préparation est possible pour un agent Hub habilité sur son marché.
router.post(
  '/market/:marketCode/boxes/shipment',
  attachHubExecutionCapability('execution.parcel.ship'),
  requireHubWorkspaceAction,
  async (req, res, next) => {
    try {
      const body = req.body || {};
      const result = await shipmentJourney.open(req.workspaceMarket, actionActor(req), {
        reference: body.reference,
        hub_unit_ids: body.hub_unit_ids,
      });
      return res.status(201).json({ ok: true, result });
    } catch (err) {
      return sendWorkspaceError(err, res, next);
    }
  }
);

router.post(
  '/market/:marketCode/boxes/:unitId/shipment',
  attachHubExecutionCapability('execution.parcel.ship'),
  requireHubWorkspaceAction,
  async (req, res, next) => {
    try {
      const result = await boxShipment.attachBoxToShipment({
        unitId: req.params.unitId,
        shipmentReference: (req.body || {}).shipment_reference,
        expectedMarketId: req.workspaceMarket.id,
        actor: actionActor(req),
      });
      return res.status(201).json(result);
    } catch (err) {
      return sendWorkspaceError(err, res, next);
    }
  }
);

// Retrait autorisé jusqu'à remise physique, avec marché serveur et audit acteur.
router.post(
  '/market/:marketCode/boxes/:unitId/detach',
  attachHubExecutionCapability('execution.parcel.ship'),
  requireHubWorkspaceAction,
  async (req, res, next) => {
    try {
      const result = await boxShipment.detachBoxFromShipment({
        unitId: req.params.unitId, expectedMarketId: req.workspaceMarket.id, actor: actionActor(req),
      });
      return res.json({ ok: true, result });
    } catch (err) { return sendWorkspaceError(err, res, next); }
  }
);

router.post(
  '/market/:marketCode/distribution/run',
  attachHubExecutionCapability('execution.distribution.run'),
  requireHubWorkspaceAction,
  async (req, res, next) => {
    try {
      const result = await workspace.runDistribution(req.workspaceMarket);
      return res.json({ ok: true, action: 'run_distribution', result });
    } catch (err) {
      return sendWorkspaceError(err, res, next);
    }
  }
);

router.post(
  '/market/:marketCode/orders/:reference/distribute',
  attachHubExecutionCapability('execution.distribution.run'),
  requireHubWorkspaceAction,
  async (req, res, next) => {
    try {
      const result = await workspace.distributeSingleOrder(req.params.reference, req.workspaceMarket);
      return res.json({ ok: true, action: 'distribute_order', result });
    } catch (err) {
      return sendWorkspaceError(err, res, next);
    }
  }
);

router.post(
  '/market/:marketCode/parcels/:reference/ship',
  attachHubExecutionCapability('execution.parcel.ship'),
  requireHubWorkspaceAction,
  async (req, res, next) => {
    try {
      const result = await workspace.scanParcel(
        req.params.reference,
        'ship',
        req.workspaceMarket,
        actionActor(req),
        req.body
      );
      return res.json({ ok: true, action: 'ship', result });
    } catch (err) {
      return sendWorkspaceError(err, res, next);
    }
  }
);

router.post(
  '/market/:marketCode/orders/:reference/confirm-cash',
  attachRelayExecutionCapability('execution.cash.confirm'),
  requireRelayWorkspaceAction,
  requireRelayPhysicalMarket,
  async (req, res, next) => {
    try {
      const result = await workspace.confirmCash(
        req.params.reference,
        req.workspaceMarket,
        actionActor(req)
      );
      return sendCashConfirmationResult(res, result);
    } catch (err) {
      return sendWorkspaceError(err, res, next);
    }
  }
);

// Relais live — contenu réellement expédié (Expédition → KOM-BOX → commandes → articles) et réception attestée PAR LE RELAIS.
router.get(
  '/market/:marketCode/relay-shipments',
  requireWorkspaceReadAccess,
  async (req, res, next) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      const relaisId = req.user && req.user.role === 'agent_relais' ? req.user.relais_id || null : null;
      return res.json(await relayReceipts.listRelayShipments({ market: req.workspaceMarket, relaisId }));
    } catch (err) {
      return sendWorkspaceError(err, res, next);
    }
  }
);

// Scan du sac au relais : seul le colis de cette expédition et de ce relais est visible.
router.get(
  '/market/:marketCode/relay-shipments/:reference/bags/:bagRef',
  attachRelayExecutionCapability('execution.parcel.receive'),
  requireRole(['admin', 'agent_relais']),
  requireRelayPhysicalMarket,
  async (req, res, next) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      const result = await bagBox.getBagAtRelay({
        bagReference: req.params.bagRef, shipmentReference: req.params.reference,
        expectedMarketId: req.workspaceMarket.id,
        relaisId: req.relayMarketAuthority ? req.relayMarketAuthority.relais_id : null,
      });
      return res.json(result);
    } catch (err) { return sendWorkspaceError(err, res, next); }
  }
);

router.post(
  '/market/:marketCode/relay-shipments/:reference/receive',
  attachRelayExecutionCapability('execution.parcel.receive'),
  requireRole(['agent_relais']),
  requireRelayPhysicalMarket,
  async (req, res, next) => {
    try {
      const result = await relayReceipts.receiveShipment({
        market: req.workspaceMarket,
        actor: { ...actionActor(req), relais_id: req.user && req.user.relais_id },
        reference: req.params.reference,
        body: req.body || {},
      });
      return res.status(201).json({ ok: true, action: 'relay_shipment_receive', result });
    } catch (err) {
      return sendWorkspaceError(err, res, next);
    }
  }
);

router.post(
  '/market/:marketCode/parcels/:reference/receive',
  attachRelayExecutionCapability('execution.parcel.receive'),
  requireRelayWorkspaceAction,
  requireRelayPhysicalMarket,
  async (req, res, next) => {
    try {
      const result = await workspace.scanParcel(
        req.params.reference,
        'receive',
        req.workspaceMarket,
        actionActor(req),
        req.body
      );
      return res.json({ ok: true, action: 'receive', result });
    } catch (err) {
      return sendWorkspaceError(err, res, next);
    }
  }
);

router.post(
  '/market/:marketCode/parcels/:reference/collect',
  attachRelayExecutionCapability('execution.parcel.collect'),
  requireRelayWorkspaceAction,
  requireRelayPhysicalMarket,
  async (req, res, next) => {
    try {
      const result = await workspace.scanParcel(
        req.params.reference,
        'collect',
        req.workspaceMarket,
        actionActor(req),
        req.body
      );
      return res.json({ ok: true, action: 'collect', result });
    } catch (err) {
      return sendWorkspaceError(err, res, next);
    }
  }
);

router.post(
  '/market/:marketCode/inventory/items/:itemId/assign',
  attachHubExecutionCapability('execution.inventory.assign'),
  requireHubWorkspaceAction,
  async (req, res, next) => {
    try {
      const parcelReference = req.body && req.body.parcel_ref;
      const result = await workspace.assignInventory(
        req.params.itemId,
        parcelReference,
        req.workspaceMarket
      );
      return res.json({ ok: true, action: 'assign_inventory', result });
    } catch (err) {
      return sendWorkspaceError(err, res, next);
    }
  }
);

module.exports = router;
module.exports._test = {
  rejectClientMarketAuthority,
  resolveRequestedMarket,
  requireRelayMarketBinding,
  requireWorkspaceReadAccess,
  requireRelayPhysicalMarket,
  actionActor,
  sendCashConfirmationResult,
  sendWorkspaceError,
};
