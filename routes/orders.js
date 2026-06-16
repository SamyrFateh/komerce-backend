/**
 * @komerce-arch
 * @role          orders-http-facade
 * @domain        orders
 * @layer         route
 * @criticality   critical
 * @inputs        cart_items, client_identity, relais_id, payment_mode, wallet_choice
 * @outputs       order, order_history, tracking_data, wallet_application
 * @depends       services/order-service.js, services/order-status-machine.js, services/inventory-service.js, services/notification-service.js, db.js
 * @used-by       bootstrap/api-routes.js, public/boutique/js/b-checkout.js, public/boutique/js/b-tracking.js
 * @doctrine      paiement_seul_acte_engageant, order_creation_idempotent, stock_apres_paiement
 * @impact-areas  checkout, orders, tracking, wallet, stock, notifications, shared-cart
 * @version       2026-06
 */

/**
 * KOMERCE — Commandes v7.5 → v8.0 (refactorisé)
 *
 * POST  /api/orders               → créer une commande (client authentifié)
 * GET   /api/orders               → liste des commandes du client connecté
 * GET   /api/orders/relais        → commandes du relais (agent_relais)
 * GET   /api/orders/problems      → commandes problématiques (admin/agents)
 * GET   /api/orders/credits       → crédits boutique du client
 * GET   /api/orders/:ref          → détail + suivi public par référence
 * PATCH /api/orders/:id/status    → changer statut (admin/agent_hub/agent_relais)
 * PATCH /api/orders/:id/cost      → saisir le coût réel (admin)
 * GET   /api/orders/:id/history   → historique statuts
 * POST  /api/orders/:id/cancel    → annulation commande
 * POST  /api/orders/:id/qr-token  → générer token QR (admin/agent_relais)
 * GET   /api/orders/retrait/:token → page HTML retrait client (publique)
 * POST  /api/orders/:id/mark-availability → disponibilité articles (agent_hub)
 * POST  /api/orders/:id/partial-ship      → expédition partielle (agent_hub)
 * GET   /api/orders/:id/parcels           → liste colis d'une commande
 * PATCH /api/orders/parcels/:parcelId/status → statut colis
 * POST  /api/orders/:id/cancel-backorder  → annuler un backorder
 *
 * Architecture : fichier mince qui agrège les sous-routers.
 * Toute la logique métier est dans routes/orders/ et services/.
 */

'use strict';

const express = require('express');
const router  = express.Router();

// ── Routes avec préfixes fixes — AVANT les routes paramétrées (:id, :ref) ────
// L'ordre est critique pour éviter les collisions Express.

router.use('/', require('./orders/list'));    // GET /  /relais  /problems  /credits
router.use('/', require('./orders/qr'));      // GET /retrait/:token  POST /:id/qr-token
router.use('/', require('./orders/parcels')); // PATCH /parcels/:parcelId  GET /:id/parcels  etc.
router.use('/', require('./orders/cancel'));  // POST /:id/cancel
router.use('/', require('./orders/status'));  // PATCH /:id/status  /:id/cost
router.use('/', require('./orders/create'));  // POST /
router.use('/', require('./orders/detail')); // GET /:ref  /:id/history

module.exports = router;
