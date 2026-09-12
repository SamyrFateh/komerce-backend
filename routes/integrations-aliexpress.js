/**
 * @komerce-arch
 * @role          aliexpress-oauth-integration-route
 * @domain        catalog
 * @layer         route
 * @criticality   high
 * @inputs        admin OAuth start/status requests, AliExpress OAuth callback
 * @outputs       provider redirect, encrypted OAuth connection status
 * @depends       middleware/auth.js, services/suppliers/aliexpress-oauth.js
 * @used-by       bootstrap/api-routes.js
 * @db-read       supplier_oauth_connections
 * @db-write      supplier_oauth_connections
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md
 * @impact-areas  catalog, supplier-import, auth
 * @version       2026-09-v1
 */
'use strict';

const crypto = require('crypto');
const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const oauth = require('../services/suppliers/aliexpress-oauth');

const STATE_COOKIE = 'komerce_aliexpress_oauth_state';
const STATE_TTL_MS = 10 * 60 * 1000;
const CALLBACK_PATH = '/oauth/callback';

function secureCookie(env = process.env) {
  return env.NODE_ENV === 'production' || env.KOMERCE_ENV === 'staging' || env.KOMERCE_ENV === 'production';
}

function cookieOptions(env = process.env) {
  return {
    httpOnly: true,
    secure: secureCookie(env),
    sameSite: 'lax',
    maxAge: STATE_TTL_MS,
    path: `/api/integrations/aliexpress${CALLBACK_PATH}`,
  };
}

function sameState(expected, actual) {
  if (!expected || !actual) return false;
  const a = Buffer.from(String(expected), 'utf8');
  const b = Buffer.from(String(actual), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function successHtml() {
  return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Komerce · AliExpress connecté</title></head><body><main><h1>AliExpress connecté à Komerce</h1><p>L’autorisation a été enregistrée. Aucun token n’est affiché dans cette page.</p><p>Vous pouvez fermer cet onglet et revenir dans le sourcing Komerce.</p></main></body></html>';
}

function errorHtml(message) {
  const safe = String(message || 'Autorisation AliExpress impossible').replace(/[<>&"']/g, '');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Komerce · AliExpress</title></head><body><main><h1>Connexion AliExpress non finalisée</h1><p>${safe}</p></main></body></html>`;
}

function createRouter({ oauthService = oauth, env = process.env } = {}) {
  const router = express.Router();

  router.get('/oauth/start', authenticate, requireAdmin, (req, res) => {
    try {
      const state = crypto.randomBytes(32).toString('base64url');
      res.cookie(STATE_COOKIE, state, cookieOptions(env));
      return res.redirect(302, oauthService.buildAuthorizationUrl(state, { env }));
    } catch (err) {
      return res.status(503).json({ error: 'AliExpress OAuth non configuré', detail: err.message });
    }
  });

  router.get(CALLBACK_PATH, async (req, res) => {
    const expectedState = req.cookies?.[STATE_COOKIE];
    const returnedState = req.query?.state;
    res.clearCookie(STATE_COOKIE, { ...cookieOptions(env), maxAge: undefined });

    if (!sameState(expectedState, returnedState)) {
      return res.status(400).type('html').send(errorHtml('État OAuth invalide ou expiré. Relancez la connexion depuis Komerce.'));
    }
    if (req.query?.error) {
      return res.status(400).type('html').send(errorHtml('AliExpress a refusé ou annulé l’autorisation.'));
    }
    const code = typeof req.query?.code === 'string' ? req.query.code.trim() : '';
    if (!code) {
      return res.status(400).type('html').send(errorHtml('Code d’autorisation AliExpress absent.'));
    }

    try {
      await oauthService.exchangeAuthorizationCode(code, { env });
      return res.status(200).type('html').send(successHtml());
    } catch (err) {
      console.error('[aliexpress-oauth] callback exchange failed:', err.message);
      return res.status(502).type('html').send(errorHtml('AliExpress n’a pas pu être relié à Komerce. Relancez l’autorisation.'));
    }
  });

  router.get('/status', authenticate, requireAdmin, async (req, res) => {
    try {
      return res.json(await oauthService.getConnectionStatus({ env }));
    } catch (err) {
      return res.status(503).json({ connected: false, supplier: 'aliexpress', error: err.message });
    }
  });

  router.post('/oauth/refresh', authenticate, requireAdmin, async (req, res) => {
    try {
      const current = await oauthService.loadConnection({ env });
      if (!current) return res.status(409).json({ error: 'AliExpress non connecté' });
      const refreshed = await oauthService.refreshConnection(current, { env });
      return res.json(oauthService.safeStatus(refreshed, { source: 'manual_refresh' }));
    } catch (err) {
      return res.status(502).json({ error: 'Rafraîchissement AliExpress impossible', detail: err.message });
    }
  });

  return router;
}

const router = createRouter();
router.createRouter = createRouter;
router.STATE_COOKIE = STATE_COOKIE;
router.sameState = sameState;
router.cookieOptions = cookieOptions;
module.exports = router;
