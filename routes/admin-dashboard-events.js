/**
 * @komerce-arch
 * @role          dashboard-post-commit-event-stream
 * @domain        dashboard
 * @layer         route
 * @criticality   high
 * @inputs        authenticated_admin_session, postgres_change_hints
 * @outputs       authenticated_sse_invalidation_hints
 * @depends       middleware/auth, dashboard-invalidation-bus
 * @used-by       bootstrap/api-routes.js
 * @db-read       users, revoked_tokens
 * @db-write      none
 * @db-txn        none
 * @doctrine      never_stream_business_data, refetch_authorized_api
 * @impact-areas  admin-dashboard, hub
 * @version       2026-11
 */
'use strict';
const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const bus = require('../services/dashboard-invalidation-bus');
const router = express.Router();

router.get('/events', authenticate, requireRole(['admin', 'agent_hub']), (req, res) => {
  if (process.env.KOMERCE_DASHBOARD_LIVE_ENABLED !== 'true') {
    // EventSource interprète 204 comme arrêt définitif : pas de 503 répétés.
    return res.status(204).end();
  }
  // Ce canal transporte seulement le signal opaque "relire", jamais un identifiant
  // de commande, un marché, une somme ou une donnée de client. Les GET officiels
  // refont systématiquement l'authentification et l'autorisation serveur.
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'private, no-store, no-transform',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive',
  });
  res.flushHeaders?.();
  res.write('retry: 5000\n\nevent: refresh\ndata: {}\n\n');
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    clearInterval(heartbeat);
    clearTimeout(expiry);
    if (!res.destroyed && !res.writableEnded) res.end();
  };
  const unsubscribe = bus.subscribe(() => {
    if (closed || res.writableEnded) return;
    // Aucune mise en file d'attente illimitée si le navigateur cesse de lire.
    if (!res.write('event: refresh\ndata: {}\n\n')) close();
  });
  const heartbeat = setInterval(() => {
    if (!closed) res.write(': alive\n\n');
  }, 15000);
  heartbeat.unref?.();
  // Revalidation forcée du JWT + du rôle par la route à chaque reconnexion.
  // Une session révoquée ne reçoit aucun contenu métier : le flux est coupé
  // au plus tard à cette échéance et les API de lecture contrôlent chaque GET.
  const maxConnectionMs = Math.max(1000, Math.min(60000,
    req.auth && req.auth.exp ? req.auth.exp * 1000 - Date.now() : 60000));
  const expiry = setTimeout(close, maxConnectionMs);
  expiry.unref?.();
  res.on('close', close);
  bus.start().catch(() => {});
});

module.exports = router;
