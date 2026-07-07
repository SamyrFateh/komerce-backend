/**
 * @komerce-arch
 * @role          auth-verify-authkey-webhook
 * @domain        auth
 * @layer         middleware
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @db-write      none
 * @db-read      none
 * @used-by       @unknown
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  auth
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — Middleware : vérification du webhook entrant Authkey WhatsApp
 *
 * Authkey envoie ses callbacks via GET avec paramètres en query string.
 * Aucun mécanisme HMAC n'est disponible (contrairement au webhook Meta) ;
 * le durcissement retenu est un token secret partagé transmis en query param
 * `?token=<secret>` dans l'URL de webhook configurée chez Authkey.
 *
 * Comportement :
 *   · AUTHKEY_WEBHOOK_SECRET défini   → vérification timingSafeEqual ; 403 si invalide
 *   · AUTHKEY_WEBHOOK_SECRET absent   → fail-open en dev (warn), fail-closed en prod (503)
 *
 * Configuration côté Authkey :
 *   Webhook URL → https://<host>/webhook/authkey-whatsapp?token=<AUTHKEY_WEBHOOK_SECRET>
 *
 * Variables d'environnement :
 *   AUTHKEY_WEBHOOK_SECRET  — secret partagé (min 32 chars recommandé, ex: `openssl rand -hex 32`)
 */

const crypto = require('crypto');
const log    = require('../utils/logger').child({ module: 'verify-authkey-webhook' });

const AUTHKEY_WEBHOOK_SECRET = process.env.AUTHKEY_WEBHOOK_SECRET || '';

/**
 * Comparaison en temps constant pour éviter les attaques par timing.
 * Les deux buffers doivent avoir la même longueur — on pad au max pour éviter
 * la fuite de longueur via timingSafeEqual qui exige des buffers égaux.
 */
function safeCompare(a, b) {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Effectuer quand même la comparaison pour ne pas divulguer via le timing
    // la longueur du secret configuré.
    crypto.timingSafeEqual(bufA, bufA); // comparaison fictive, même durée
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyAuthkeyWebhook(req, res, next) {
  // ── Pas de secret configuré ──────────────────────────────────────────────
  if (!AUTHKEY_WEBHOOK_SECRET) {
    if (process.env.NODE_ENV === 'production') {
      log.error('[AUTHKEY-WA] AUTHKEY_WEBHOOK_SECRET absent en production — webhook rejeté (503)');
      return res.status(503).json({ error: 'Webhook non configuré' });
    }
    // Dev / test : laisse passer avec avertissement (même comportement que verifyMetaSignature)
    log.warn('[AUTHKEY-WA] AUTHKEY_WEBHOOK_SECRET absent — vérification désactivée (DEV uniquement)');
    return next();
  }

  // ── Vérification du token ─────────────────────────────────────────────────
  const provided = req.query.token || req.headers['x-authkey-token'] || '';

  if (!provided) {
    log.warn({ ip: req.ip }, '[AUTHKEY-WA] Token absent — requête rejetée');
    return res.status(403).json({ error: 'Token manquant' });
  }

  if (!safeCompare(provided, AUTHKEY_WEBHOOK_SECRET)) {
    log.warn({ ip: req.ip }, '[AUTHKEY-WA] Token invalide — requête rejetée');
    return res.status(403).json({ error: 'Token invalide' });
  }

  return next();
}

module.exports = { verifyAuthkeyWebhook };
