/**
 * @komerce-arch
 * @role          notification-meta-whatsapp
 * @domain        notification
 * @layer         route
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       none
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  notification
 * @version       2026-06
 */

'use strict';

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const log = require('../utils/logger').child({ module: 'meta-whatsapp' });

const VERIFY_TOKEN   = process.env.META_WA_VERIFY_TOKEN || 'komerce_meta_verify_token';
const WA_APP_SECRET  = process.env.META_WA_APP_SECRET;

// P4-2 : l'ancien comportement laissait passer les POST sans vérification HMAC
// si META_WA_APP_SECRET était absent (fail-open silencieux, juste un warn).
// Comme pour JWT_SECRET (routes/auth.js, N7), pas de fallback autorisé : le
// process refuse de démarrer plutôt que d'exposer un webhook non authentifié.
if (!WA_APP_SECRET) {
  log.error('FATAL: META_WA_APP_SECRET manquant — démarrage impossible');
  process.exit(1); // pas de fallback autorisé, même en dev
}

/**
 * Vérifie la signature HMAC-SHA256 envoyée par Meta dans X-Hub-Signature-256.
 */
function verifyMetaSignature(req, res, next) {
  const sig = req.headers['x-hub-signature-256'];
  if (!sig || !sig.startsWith('sha256=')) {
    return res.status(403).json({ error: 'Signature Meta manquante' });
  }

  const rawBody = req.rawBody || JSON.stringify(req.body);
  const expected = 'sha256=' + crypto
    .createHmac('sha256', WA_APP_SECRET)
    .update(rawBody, 'utf8')
    .digest('hex');

  // P4-2 : timingSafeEqual exige deux buffers de MÊME longueur, sinon il
  // lève une exception (pas un simple false) — une signature malformée ou
  // tronquée ferait planter le process avant ce guard (500 non contrôlé
  // au lieu d'un rejet 403 propre).
  const sigBuf = Buffer.from(sig, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expectedBuf.length) {
    log.warn('[META-WA] Signature HMAC de longueur invalide — requête rejetée');
    return res.status(403).json({ error: 'Signature Meta invalide' });
  }

  const valid = crypto.timingSafeEqual(sigBuf, expectedBuf);

  if (!valid) {
    log.warn('[META-WA] Signature HMAC invalide — requête rejetée');
    return res.status(403).json({ error: 'Signature Meta invalide' });
  }

  return next();
}

/**
 * Log metadata only. Never copy arbitrary webhook keys or values into logs:
 * Meta payloads contain customer numbers, profile names and message content.
 * This is an observational summary, not a delivery-status consumer (GAP-5).
 */
function summarizeMetaWebhook(body) {
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  const counts = { messages: 0, statuses: 0 };
  const statusNames = new Set();
  const messageIds = [];
  const ALLOWED_STATUS = new Set(['sent', 'delivered', 'read', 'failed']);

  // Input is signed but still untrusted. Bound inspection and log output.
  for (const entry of entries.slice(0, 100)) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes.slice(0, 100)) {
      const value = change?.value;
      const messages = Array.isArray(value?.messages) ? value.messages : [];
      const statuses = Array.isArray(value?.statuses) ? value.statuses : [];
      counts.messages += messages.length;
      counts.statuses += statuses.length;
      for (const status of statuses.slice(0, 100)) {
        if (ALLOWED_STATUS.has(status?.status)) statusNames.add(status.status);
      }
      for (const item of [...statuses.slice(0, 3), ...messages.slice(0, 3)]) {
        if (messageIds.length >= 3) break;
        // Only provider-style opaque IDs, never phone numbers or free text.
        const id = item?.id;
        if (typeof id === 'string' && /^wamid\\.[A-Za-z0-9_-]{8,100}$/.test(id) &&
            !messageIds.includes(id)) {
          messageIds.push(id);
        }
      }
    }
  }

  return {
    event_type: counts.messages && counts.statuses ? 'mixed'
      : counts.messages ? 'messages' : counts.statuses ? 'statuses' : 'unknown',
    entry_count: Math.min(entries.length, 1000),
    message_count: Math.min(counts.messages, 1000),
    status_count: Math.min(counts.statuses, 1000),
    statuses: [...statusNames],
    wamids: messageIds,
  };
}

router.get('/webhook/meta-whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

router.post('/webhook/meta-whatsapp', verifyMetaSignature, async (req, res) => {
  try {
    const body = req.body || {};

    log.info('[META-WA][WEBHOOK]', summarizeMetaWebhook(body));

    // Ici plus tard:
    // - status sent/delivered/read/failed
    // - mapping wamid -> order_ref / event
    // - messages entrants client -> support

    return res.sendStatus(200);
  } catch (e) {
    log.error({ err: e }, '[META-WA][WEBHOOK][ERROR]');
    return res.sendStatus(500);
  }
});

module.exports = router;
module.exports.summarizeMetaWebhook = summarizeMetaWebhook;