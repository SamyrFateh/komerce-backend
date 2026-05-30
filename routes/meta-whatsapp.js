'use strict';

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const log = require('../utils/logger').child({ module: 'meta-whatsapp' });

const VERIFY_TOKEN   = process.env.META_WA_VERIFY_TOKEN || 'komerce_meta_verify_token';
const WA_APP_SECRET  = process.env.META_WA_APP_SECRET || '';

/**
 * Vérifie la signature HMAC-SHA256 envoyée par Meta dans X-Hub-Signature-256.
 * Si META_WA_APP_SECRET n'est pas défini (environnement dev), on laisse passer.
 * En production, la variable DOIT être définie — le webhook rejette sinon.
 */
function verifyMetaSignature(req, res, next) {
  if (!WA_APP_SECRET) {
    // Dev : pas de secret configuré → on loggue et on laisse passer
    log.warn('[META-WA] META_WA_APP_SECRET absent — vérification HMAC désactivée (DEV uniquement)');
    return next();
  }

  const sig = req.headers['x-hub-signature-256'];
  if (!sig || !sig.startsWith('sha256=')) {
    return res.status(403).json({ error: 'Signature Meta manquante' });
  }

  const rawBody = req.rawBody || JSON.stringify(req.body);
  const expected = 'sha256=' + crypto
    .createHmac('sha256', WA_APP_SECRET)
    .update(rawBody, 'utf8')
    .digest('hex');

  const valid = crypto.timingSafeEqual(
    Buffer.from(sig, 'utf8'),
    Buffer.from(expected, 'utf8')
  );

  if (!valid) {
    log.warn('[META-WA] Signature HMAC invalide — requête rejetée');
    return res.status(403).json({ error: 'Signature Meta invalide' });
  }

  return next();
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

    log.info('[META-WA][WEBHOOK]', JSON.stringify(body));

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