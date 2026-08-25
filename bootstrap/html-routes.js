/**
 * @komerce-arch
 * @role          bootstrap-html-routes
 * @domain        infrastructure
 * @layer         bootstrap
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result
 * @depends       utils/logger.js
 * @db-write      none
 * @db-read      none
 * @used-by       server.js
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  bootstrap
 * @version       2026-08
 */

'use strict';

const path = require('path');
const log  = require('../utils/logger').child({ module: 'html-routes' });

function sendHtml(res, filePath, cache = 'no-cache') {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.sendFile(filePath, (err) => {
    if (err && err.code === 'ENOENT') {
      log.error({ filePath, code: err.code }, 'Fichier HTML introuvable');
      if (!res.headersSent) res.status(404).send('Page introuvable');
    }
  });
}

function redirectToBoutique(res) {
  res.redirect(302, '/boutique');
}

function safeToken(raw) {
  const token = String(raw || '').trim();
  return token && token.length <= 80 && /^[\w-]+$/.test(token) ? token : '';
}

function redirectToGroup(res, token, extra = '') {
  const cleanToken = safeToken(token);
  const params = new URLSearchParams();
  if (cleanToken) params.set('p', cleanToken);
  if (extra) params.set('shared_payment', extra);
  params.set('tab', 'group');
  res.redirect(302, '/boutique/?' + params.toString());
}

function mountHtmlRoutes(app, rootDir) {
  const publicDir = path.join(rootDir, 'public');

  app.get('/s/:token', (req, res) => {
    sendHtml(res, path.join(publicDir, 'suivi.html'));
  });

  app.get('/c/:token', (req, res) => {
    const token = req.params.token;
    if (!safeToken(token)) return res.redirect('/Komerce_Boutique.html');
    redirectToGroup(res, token);
  });

  app.get('/mon-compte', (req, res) => {
    sendHtml(res, path.join(publicDir, 'mon-compte.html'));
  });

  app.get('/cart/shared/success', (req, res) => {
    redirectToGroup(res, req.query.p || req.query.token, 'success');
  });
  app.get('/cart/shared/cancel', (req, res) => {
    redirectToGroup(res, req.query.p || req.query.token, 'cancel');
  });
  app.get('/cart/shared/:token', (req, res) => {
    redirectToGroup(res, req.params.token);
  });
  app.get('/cart/shared', (req, res) => {
    redirectToGroup(res, req.query.p || req.query.token || req.query.share);
  });
  app.get('/account/shared-carts', (req, res) => {
    redirectToGroup(res, req.query.p || req.query.token || req.query.share);
  });

  // ── Admin Canonical — LOT 2-CUTOVER ────────────────────────────────────
  // Les quatre dashboards prouvés prennent leurs URLs stables. Les anciennes
  // capacités qui n'ont pas encore d'équivalent Canonical restent servies par
  // Legacy 1 : le cutover est additif, jamais destructif.
  const canonicalAdminPath = path.join(publicDir, 'dashboards', 'canonical', 'index.html');
  const legacyAdminPath = path.join(publicDir, 'dashboards', 'admin', 'index.html');

  function sendCanonicalAdmin(res) {
    res.setHeader('X-Admin-Generation', 'canonical');
    sendHtml(res, canonicalAdminPath);
  }

  function sendLegacyAdmin(res) {
    res.setHeader('X-Admin-Generation', 'legacy-1');
    sendHtml(res, legacyAdminPath);
  }

  // Pilotage est la seule URL stable qui entrait déjà en collision avec
  // Legacy 1. `?legacy=1` fournit donc un rollback immédiat sans modifier le
  // pathname vu par le routeur SPA historique.
  app.get('/admin/pilotage', (req, res) => {
    if (req.query && req.query.legacy === '1') return sendLegacyAdmin(res);
    sendCanonicalAdmin(res);
  });

  [
    '/admin',
    '/admin/commerce',
    '/admin/operations',
    '/admin/finance',
    '/admin/demo',
  ].forEach(routePath => {
    app.get(routePath, (req, res) => {
      sendCanonicalAdmin(res);
    });
  });

  // LOT 3A — première Entity 360 Canonical. La référence reste lisible dans
  // l'URL ; l'autorité de marché est vérifiée exclusivement côté API.
  app.get('/admin/orders/:orderReference', (req, res) => {
    sendCanonicalAdmin(res);
  });

  // LOT 3B — Client 360 Canonical. L'URL détaillée est canonique, tandis que
  // `/admin/clients` sans identifiant reste Legacy 1 jusqu'à reconstruction
  // d'une vraie surface de recherche/navigation clients.
  app.get('/admin/clients/:clientPhone', (req, res) => {
    sendCanonicalAdmin(res);
  });

  // Les URLs de construction restent des aliases temporaires mais ne créent
  // plus une seconde URL produit : elles ramènent systématiquement vers le
  // pathname stable correspondant.
  const CANONICAL_BUILD_ALIASES = Object.freeze({
    '/admin-next': '/admin/pilotage',
    '/admin-next/commerce': '/admin/commerce',
    '/admin-next/operations': '/admin/operations',
    '/admin-next/finance': '/admin/finance',
    '/admin-next/demo': '/admin/demo',
    '/admin/pilotage-v2': '/admin/pilotage',
  });

  Object.entries(CANONICAL_BUILD_ALIASES).forEach(([routePath, stablePath]) => {
    app.get(routePath, (req, res) => {
      res.redirect(302, stablePath);
    });
  });

  // Legacy 1 reste accessible pour toutes les capacités non encore remplacées
  // par un Workspace / Entity 360 / Action Center Canonical.
  const ADMIN_DASHBOARD_PATHS = [
    '/admin/control-tower',
    '/admin/costing',
    '/admin/orders-logistics',
    '/admin/sourcing',
    '/admin/sourcing-scanner',
    '/admin/pricing',
    '/admin/pricing-workshop',
    '/admin/pricing-strategy',
    '/admin/customs',
    '/admin/suppliers',
    '/admin/alerts',
    '/admin/categories',
    '/admin/products',
    '/admin/sales',
    '/admin/clients',
    '/admin/problems',
    '/admin/hub-relais',
    '/admin/transitaire',
    '/admin/inventory',
    '/admin/economic',
    '/admin/pilotage-fin',
    '/admin/invoices',
    '/admin/sante',
    '/admin/shared-carts',
    '/admin/economic-flow',
    '/admin/accounting',
    '/admin/settings',
    '/admin/simulator',
  ];

  ADMIN_DASHBOARD_PATHS.forEach(routePath => {
    app.get(routePath, (req, res) => {
      sendLegacyAdmin(res);
    });
  });

  ['/portail', '/pilotage'].forEach(routePath => {
    app.get(routePath, (req, res) => {
      sendHtml(res, path.join(publicDir, 'dashboards', 'admin', 'portal-pilotage.html'));
    });
  });

  app.get('/control-tower.html', (req, res) => {
    if (process.env.ADMIN_LEGACY_ENABLED === '1') {
      res.setHeader('X-Deprecated', 'control-tower.html — migrer vers /admin/pilotage');
      return sendHtml(res, path.join(publicDir, 'dashboards', 'admin-legacy', 'control-tower.html'));
    }
    res.redirect(301, '/admin/pilotage');
  });

  app.get('/Komerce_Relais.html', (req, res) => {
    sendHtml(res, path.join(publicDir, 'relais', 'index.html'));
  });
  app.get('/relais', (req, res) => {
    sendHtml(res, path.join(publicDir, 'relais', 'index.html'));
  });
  app.get('/hub', (req, res) => {
    sendHtml(res, path.join(publicDir, 'hub', 'index.html'));
  });

  app.get('/event/create', (req, res) => redirectToBoutique(res));
  app.get('/event/manage/:creatorToken', (req, res) => redirectToBoutique(res));
  app.get('/event/w/:publicToken', (req, res) => redirectToBoutique(res));
  app.get('/event/pay/:paymentToken', (req, res) => redirectToBoutique(res));
  app.get('/event/:creatorToken/manage', (req, res) => redirectToBoutique(res));
  app.get('/workspace/:publicToken', (req, res) => redirectToBoutique(res));

  app.get('/Komerce_Boutique.html', (req, res) => {
    sendHtml(res, path.join(publicDir, 'boutique', 'index.html'));
  });
  app.get('/boutique', (req, res) => {
    sendHtml(res, path.join(publicDir, 'boutique', 'index.html'));
  });
  app.get('/login.html', (req, res) => {
    sendHtml(res, path.join(publicDir, 'login.html'));
  });

  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'Endpoint introuvable' });
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.sendFile(path.join(publicDir, 'boutique', 'index.html'));
  });
}

module.exports = { mountHtmlRoutes };