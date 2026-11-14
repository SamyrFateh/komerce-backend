/**
 * @komerce-arch
 * @role          dashboard-hub-dashboard
 * @domain        dashboard
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, middleware/require-market-delegated-role.js, middleware/require-market-delegated-capability.js, services/*, services/live-projection.js
 * @used-by       bootstrap/api-routes.js
 * @db-read       markets, market_operating_assignments, assignment_memberships, membership_capabilities, assignment_capability_ceiling, order_items, orders, parcel_items, parcels, products
 * @db-write      order_comments, order_incidents
 * @db-write-via:parcel-item-mutation-service parcel_events, parcel_items
 * @db-write-via:parcel-mutation-service parcels
 * @db-write-via:scan-write-service scans
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change, capability_is_the_authority_not_role, central_hub_roles_remain_global
 * @impact-areas  dashboard, admin-dashboard, market
 * @version       2026-10-d4
 */

/**
 * KOMERCE — Hub Dashboard API v1.0
 * Centre de contrôle opérateur hub (Dubai)
 *
 * GET  /dashboard       — KPIs temps réel
 * GET  /queue           — File de travail priorisée
 * GET  /orders/:id      — Détail complet commande + colis + paiement + client
 * GET  /validate/:id    — Validations anti-erreur avant action
 * POST /orders/:id/start-prep   — 410 (fermé)
 * POST /orders/:id/create-parcel — 410 (fermé)
 * POST /parcels/:id/add-item    — 410 (fermé)
 * POST /parcels/:id/remove-item — 410 (fermé)
 * POST /parcels/:id/ready       — 410 (fermé)
 * POST /parcels/:id/ship        — 410 (fermé)
 * POST /orders/:id/auto-prepare  — 410 (fermé)
 * POST /parcels/:id/reassign-item — 410 (fermé)
 * POST /orders/:id/incident     — Signaler incident
 * POST /orders/:id/escalate     — Escalader admin
 * POST /orders/:id/comment      — Commentaire terrain
 * POST /orders/:id/backorder    — 410 (fermé)
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { attachMarketDelegatedRoleFor } = require('../middleware/require-market-delegated-role');
const { requireMarketDelegatedCapability, attachAuthorizedMarketsForCapability } = require('../middleware/require-market-delegated-capability');
const log = require('../utils/logger').child({ module: 'hub-dashboard' });
const hubQueries = require('../services/hub-dashboard-queries');
const { wantsSimulation } = require('../services/simulation-visibility');
const denyTransitaireHub = require('../middleware/deny-transitaire-hub');
const hubDubai = require('../services/hub-dubai-projection');
const { applyLiveProjection } = require('../services/live-projection');

const hubAuth = [authenticate, requireRole(['admin', 'agent_hub'])];

// D4 Market Control Plane — les rôles centraux admin/agent_hub gardent
// leur accès Hub global historique. Un acteur projeté market_operator doit
// désormais prouver operations.read pour les lectures ; operator_market_scopes
// n'est plus l'autorité de ces routes. Les mutations physiques restent
// exclusivement hubAuth (admin/agent_hub).
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
const hubSupervise = [
  authenticate,
  denyTransitaireHub,
  attachMarketDelegatedRoleFor(['admin', 'agent_hub', 'market_operator']),
  requireRole(['admin', 'agent_hub', 'market_operator']),
];

// ── hub.supervise (capability_is_the_authority_not_role) ────────────────────
// Les routes de supervision (incident/escalade/commentaire) sont adressées
// par :id de commande, jamais par code marché — requireMarketDelegatedCapability
// résout l'autorisation à partir de req.params.marketCode, il faut donc
// résoudre le marché de la commande AVANT de vérifier la capability.
async function resolveOrderMarket(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT o.id, o.reference, o.market_id, m.code AS market_code
         FROM orders o
         JOIN markets m ON m.id = o.market_id
        WHERE o.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Commande introuvable' });
    req.order = rows[0];
    req.params.marketCode = rows[0].market_code;
    return next();
  } catch (err) { return next(err); }
}

// admin/agent_hub restent autorisés par leur frontière centrale Hub (déjà
// vérifiée par hubBase/requireRole) — seul un market_operator doit prouver la
// capability hub.supervise, exactement comme ensureMarketOperatorCanSupervise
// ne s'appliquait qu'à ce rôle.
const hubSuperviseCapability = requireMarketDelegatedCapability('hub.supervise', { audit: false });
function requireHubSupervise(req, res, next) {
  if (req.user && req.user.role !== 'market_operator') return next();
  return hubSuperviseCapability(req, res, next);
}

// ── DDL géré par migrations/075_hub_shares_collective_schema.sql ────────────

router.get('/dashboard', ...hubRead, async (req, res, next) => {
  try {
    const data = req.user.role === 'market_operator'
      ? await hubQueries.getDashboardKPIs({ authorizedMarkets: req.authorizedMarkets })
      : await hubQueries.getDashboardKPIs();
    res.json(data);
  } catch(e) { next(e); }
});

// Flux Hub Dubaï : lecture seule (réceptions fournisseur, unités physiques par marché). Sources absentes déclarées dans `gaps`.
router.get('/dubai', ...hubRead, async (req, res, next) => {
  try {
    const data = await hubDubai.buildHubDubai(
      req.user.role === 'market_operator' ? { authorizedMarkets: req.authorizedMarkets } : {},
    );
    res.set('Cache-Control', 'private, no-store');
    res.json(data);
  } catch (e) { next(e); }
});

router.get('/queue', ...hubRead, async (req, res, next) => {
  try {
    const data = req.user.role === 'market_operator'
      ? await hubQueries.getQueue(req.query, { authorizedMarkets: req.authorizedMarkets })
      : await hubQueries.getQueue(req.query, { includeSimulation: wantsSimulation(req.user, req.query) });
    res.json(applyLiveProjection(req, data));
  } catch(e) { next(e); }
});

router.get('/orders/:id', ...hubRead, async (req, res, next) => {
  try {
    const data = req.user.role === 'market_operator'
      ? await hubQueries.getOrderDetail(req.params.id, { authorizedMarkets: req.authorizedMarkets })
      : await hubQueries.getOrderDetail(req.params.id);
    if (!data) return res.status(404).json({ error: 'Commande introuvable' });
    if (data.forbidden) return res.status(403).json({ error: 'Commande hors de votre périmètre marché', code: 'market_scope_denied' });
    res.json(applyLiveProjection(req, data));
  } catch(e) { next(e); }
});

router.get('/validate/:id', ...hubRead, async (req, res, next) => {
  try {
    const data = req.user.role === 'market_operator'
      ? await hubQueries.getValidation(req.params.id, { authorizedMarkets: req.authorizedMarkets })
      : await hubQueries.getValidation(req.params.id);
    if (!data) return res.status(404).json({ error: 'Commande introuvable' });
    if (data.forbidden) return res.status(403).json({ error: 'Commande hors de votre périmètre marché', code: 'market_scope_denied' });
    res.json(data);
  } catch(e) { next(e); }
});

// HB-09 (#3998) : une seule autorité physique Hub ; chemins historiques
// conservés temporairement avec réponse 410, authentification et rôles inchangés.
// Aucun writer, scan simulé, transition de statut ou modification de colis ici.
function legacyHubWriterClosed(_req, res) {
  return res.status(410).json({
    code: 'HUB_LEGACY_WRITER_CLOSED',
    error: 'Cette écriture Hub historique est fermée. Utiliser le parcours physique canonique.',
    canonical: '/admin/hub',
  });
}
router.post('/orders/:id/start-prep', ...hubAuth, legacyHubWriterClosed);
router.post('/orders/:id/create-parcel', ...hubAuth, legacyHubWriterClosed);
router.post('/orders/:id/auto-prepare', ...hubAuth, legacyHubWriterClosed);
router.post('/parcels/:id/add-item', ...hubAuth, legacyHubWriterClosed);
router.post('/parcels/:id/reassign-item', ...hubAuth, legacyHubWriterClosed);
router.post('/parcels/:id/remove-item', ...hubAuth, legacyHubWriterClosed);
router.post('/parcels/:id/ready', ...hubAuth, legacyHubWriterClosed);
router.post('/parcels/:id/ship', ...hubAuth, legacyHubWriterClosed);
router.post('/orders/:id/backorder', ...hubAuth, legacyHubWriterClosed);

const INCIDENT_TYPES = ['retard', 'blocage', 'paiement', 'stock', 'colis_endommage', 'colis_perdu', 'client_absent', 'autre'];

function validateIncidentBody(req, res, next) {
  const { type, description } = req.body;
  if (!type || !description) return res.status(400).json({ error: 'type et description requis' });
  if (!INCIDENT_TYPES.includes(type)) {
    return res.status(400).json({ error: `Type invalide. Valides: ${INCIDENT_TYPES.join(', ')}` });
  }
  next();
}

router.post('/orders/:id/incident', ...hubSupervise, validateIncidentBody, resolveOrderMarket, requireHubSupervise, async (req, res, next) => {
  try {
    const { type, description, priority = 'normal' } = req.body;
    const order = req.order;

    const { rows: [incident] } = await db.query(`
      INSERT INTO order_incidents (order_id, type, description, priority, reporter_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [order.id, type, description, priority, req.user.id]);

    await db.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, text)
      VALUES ($1, $2, 'Hub', $3)
    `, [order.id, req.user.id, `🚨 Incident ${type}: ${description}`]);

    res.status(201).json({ message: 'Incident signalé', incident });
  } catch(e) { next(e); }
});

function validateEscalateBody(req, res, next) {
  if (!req.body || !req.body.reason) return res.status(400).json({ error: 'Raison requise' });
  next();
}

router.post('/orders/:id/escalate', ...hubSupervise, validateEscalateBody, resolveOrderMarket, requireHubSupervise, async (req, res, next) => {
  try {
    const { reason, priority = 'high' } = req.body;
    const order = req.order;

    const { rows: [incident] } = await db.query(`
      INSERT INTO order_incidents (order_id, type, description, priority, reporter_id)
      VALUES ($1, 'autre', $2, 'urgent', $3)
      RETURNING *
    `, [order.id, `[ESCALADE] ${reason}`, req.user.id]);

    await db.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, text)
      VALUES ($1, $2, 'Hub', $3)
    `, [order.id, req.user.id, `⚠️ ESCALADE: ${reason}`]);

    res.status(201).json({
      message: `Commande ${order.reference} escaladée`,
      incident,
      priority
    });
  } catch(e) { next(e); }
});

function validateCommentBody(req, res, next) {
  if (!req.body || !req.body.content) return res.status(400).json({ error: 'Contenu requis' });
  next();
}

router.post('/orders/:id/comment', ...hubSupervise, validateCommentBody, resolveOrderMarket, requireHubSupervise, async (req, res, next) => {
  try {
    const { content, hub_stage_key: stageKey } = req.body;
    const order = req.order;
    // Les commentaires Hub d'étape sont internes et append-only. Ne pas faire
    // dériver un commentaire vers une preuve physique ou une décision financière.
    if (stageKey !== undefined && stageKey !== null) {
      if (!['admin', 'agent_hub'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Écriture réservée aux opérateurs Hub', code: 'HUB_STAGE_NOTE_FORBIDDEN' });
      }
      const validStages = ['po', 'supplier', 'reception', 'cartons', 'departure', 'remaining'];
      if (!validStages.includes(stageKey)) {
        return res.status(400).json({ error: 'Étape Hub inconnue', code: 'HUB_STAGE_INVALID' });
      }
      const noteText = typeof content === 'string' ? content.trim() : '';
      if (noteText.length < 3 || noteText.length > 1500) {
        return res.status(400).json({ error: 'Commentaire requis (3 à 1 500 caractères)', code: 'HUB_STAGE_NOTE_LENGTH' });
      }
      const { rows: [comment] } = await db.query(`
        INSERT INTO order_comments (order_id, author_id, author_name, author_role, text, hub_stage_key)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, order_id, author_name, author_role, text, created_at, hub_stage_key
      `, [order.id, req.user.id, req.user.full_name || req.user.email || 'Équipe Hub', req.user.role, noteText, stageKey]);
      res.set('Cache-Control', 'private, no-store');
      return res.status(201).json({ message: 'Commentaire de suivi ajouté (non modifiable)', comment });
    }
    // Le contrat historique des commentaires sans étape reste inchangé.
    const { rows: [comment] } = await db.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, text)
      VALUES ($1, $2, 'Hub', $3)
      RETURNING *
    `, [order.id, req.user.id, content]);
    return res.json({ message: 'Commentaire ajouté', comment });
  } catch(e) { next(e); }
});


module.exports = router;
