'use strict';

const path = require('path');

function sendHtml(res, filePath, cache = 'no-cache') {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.sendFile(filePath, (err) => {
    if (err && err.code === 'ENOENT') {
      console.error('[html-routes] fichier introuvable:', filePath);
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

  // Doctrine panier partagé : aucune page autonome fonctionnelle.
  // Les anciennes URLs publiques restent compatibles mais ramènent toutes
  // vers la boutique, onglet Groupe, qui est l'unique interface métier.
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

  const ADMIN_DASHBOARD_PATHS = [
    '/admin/pilotage',
    '/admin/control-tower',
    '/admin/costing',
    '/admin/orders-logistics',
    '/admin/event-workspaces',
    '/admin/sourcing',
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
  ];
  ADMIN_DASHBOARD_PATHS.forEach(p => {
    app.get(p, (req, res) => {
      sendHtml(res, path.join(publicDir, 'dashboards', 'admin', 'index.html'));
    });
  });

  // FRESH-105 : admin-legacy control-tower.html — redirigé vers admin moderne.
  // L'accès direct à /control-tower.html retourne maintenant une redirection 301.
  // Pour maintenir l'accès legacy en urgence : déployer ADMIN_LEGACY_ENABLED=1.
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

  // Ancien parcours "Panier Ã‰vénement Collectif / Workspace" désactivé.
  // Doctrine actuelle : tout commence et finit dans la boutique.
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

  // Page de login admin — requise par app.js (requireAdminSession → redirectToLogin → /login.html)
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
