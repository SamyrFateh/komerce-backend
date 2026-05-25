'use strict';

const path = require('path');

function sendHtml(res, filePath, cache = 'no-cache') {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.sendFile(filePath);
}

function redirectToBoutique(res) {
  res.redirect(302, '/boutique');
}

function mountHtmlRoutes(app, rootDir) {
  const publicDir = path.join(rootDir, 'public');

  app.get('/s/:token', (req, res) => {
    sendHtml(res, path.join(publicDir, 'suivi.html'));
  });

  app.get('/c/:token', (req, res) => {
    const token = req.params.token;
    if (!token || token.length > 20 || !/^[\w-]+$/.test(token)) {
      return res.redirect('/Komerce_Boutique.html');
    }
    res.redirect(301, '/boutique/?share=' + encodeURIComponent(token));
  });

  app.get('/mon-compte', (req, res) => {
    sendHtml(res, path.join(publicDir, 'mon-compte.html'));
  });

  app.get('/cart/shared/:token', (req, res) => {
    sendHtml(res, path.join(publicDir, 'boutique', 'shared-cart-public.html'));
  });
  app.get('/cart/shared', (req, res) => {
    sendHtml(res, path.join(publicDir, 'boutique', 'shared-cart-public.html'));
  });

  app.get('/account/shared-carts', (req, res) => {
    sendHtml(res, path.join(publicDir, 'boutique', 'shared-cart-account.html'));
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
  ];
  ADMIN_DASHBOARD_PATHS.forEach(p => {
    app.get(p, (req, res) => {
      sendHtml(res, path.join(publicDir, 'dashboards', 'admin', 'index.html'));
    });
  });

  app.get('/control-tower.html', (req, res) => {
    sendHtml(res, path.join(publicDir, 'dashboards', 'admin-legacy', 'control-tower.html'));
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

  // Ancien parcours "Panier Événement Collectif / Workspace" désactivé.
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

  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'Endpoint introuvable' });
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.sendFile(path.join(publicDir, 'boutique', 'index.html'));
  });
}

module.exports = { mountHtmlRoutes };
