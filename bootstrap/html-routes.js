'use strict';

/**
 * H1B — Routes HTML / static / fallback SPA.
 *
 * Ce module extrait les routes de pages publiques/admin depuis server.js sans
 * toucher aux webhooks Stripe raw-body, routes API, crons, migrations inline,
 * listen/shutdown ni logique métier.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');

function setHtmlNoCache(res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
}

function sendPublicFile(res, rootDir, ...segments) {
  setHtmlNoCache(res);
  return res.sendFile(path.join(rootDir, 'public', ...segments));
}

function mountStaticHtmlRoutes(app, { rootDir }) {
  if (!rootDir) throw new Error('[H1B] rootDir requis pour mountStaticHtmlRoutes');

  // Auth guard injection — auto-injects session checker into admin pages.
  app.get('/*.html', (req, res, next) => {
    if (
      req.path.includes('Boutique') ||
      req.path === '/boutique.html' ||
      req.path === '/portal.html' ||
      req.path === '/suivi.html' ||
      req.path === '/mon-compte.html'
    ) {
      return next();
    }

    const filePath = path.join(rootDir, 'public', req.path);
    fs.readFile(filePath, 'utf8', (err, html) => {
      if (err) return next();
      html = html.replace('</body>', '<script src="/js/auth-guard.js"></script>\n</body>');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.send(html);
    });
  });

  app.use(express.static(path.join(rootDir, 'public'), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
    }
  }));
}

function mountHtmlFallbackRoutes(app, { rootDir }) {
  if (!rootDir) throw new Error('[H1B] rootDir requis pour mountHtmlFallbackRoutes');

  // Tracking short URL: /s/:token → serve suivi.html
  app.get('/s/:token', (req, res) => {
    sendPublicFile(res, rootDir, 'suivi.html');
  });

  // Cart share short URL: /c/:token → boutique with ?share=token
  app.get('/c/:token', (req, res) => {
    const token = req.params.token;
    if (!token || token.length > 20 || !/^[\w-]+$/.test(token)) {
      return res.redirect('/Komerce_Boutique.html');
    }
    res.redirect(301, '/boutique/?share=' + encodeURIComponent(token));
  });

  // Mon Compte
  app.get('/mon-compte', (req, res) => {
    sendPublicFile(res, rootDir, 'mon-compte.html');
  });

  // Panier Partagé
  app.get('/cart/shared/:token', (req, res) => {
    sendPublicFile(res, rootDir, 'boutique', 'shared-cart-public.html');
  });
  app.get('/cart/shared', (req, res) => {
    sendPublicFile(res, rootDir, 'boutique', 'shared-cart-public.html');
  });

  // Mes Paniers Partagés
  app.get('/account/shared-carts', (req, res) => {
    sendPublicFile(res, rootDir, 'boutique', 'shared-cart-account.html');
  });

  // Admin Dashboards Sprint 1+ — shell SPA pour toutes les vues admin
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
      sendPublicFile(res, rootDir, 'dashboards', 'admin', 'index.html');
    });
  });

  // Anciens dashboards Control Tower (compatibilité descendante)
  app.get('/control-tower.html', (req, res) => {
    sendPublicFile(res, rootDir, 'dashboards', 'admin-legacy', 'control-tower.html');
  });

  // App Relais
  app.get('/Komerce_Relais.html', (req, res) => {
    sendPublicFile(res, rootDir, 'relais', 'index.html');
  });
  app.get('/relais', (req, res) => {
    sendPublicFile(res, rootDir, 'relais', 'index.html');
  });

  // App Hub
  app.get('/hub', (req, res) => {
    sendPublicFile(res, rootDir, 'hub', 'index.html');
  });

  // Panier Événement
  app.get('/event/create', (req, res) => {
    sendPublicFile(res, rootDir, 'boutique', 'event', 'create.html');
  });
  app.get('/event/manage/:creatorToken', (req, res) => {
    sendPublicFile(res, rootDir, 'boutique', 'event', 'manage.html');
  });
  app.get('/event/w/:publicToken', (req, res) => {
    sendPublicFile(res, rootDir, 'boutique', 'event', 'public.html');
  });
  app.get('/event/pay/:paymentToken', (req, res) => {
    sendPublicFile(res, rootDir, 'boutique', 'event', 'pay.html');
  });

  // Redirections legacy URLs événement
  app.get('/event/:creatorToken/manage', (req, res) => {
    res.redirect(301, '/event/manage/' + encodeURIComponent(req.params.creatorToken));
  });
  app.get('/workspace/:publicToken', (req, res) => {
    res.redirect(301, '/event/w/' + encodeURIComponent(req.params.publicToken));
  });

  // Boutique canonique
  app.get('/Komerce_Boutique.html', (req, res) => {
    sendPublicFile(res, rootDir, 'boutique', 'index.html');
  });
  app.get('/boutique', (req, res) => {
    sendPublicFile(res, rootDir, 'boutique', 'index.html');
  });

  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'Endpoint introuvable' });
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.sendFile(path.join(rootDir, 'public', 'boutique', 'index.html'));
  });
}

module.exports = {
  mountStaticHtmlRoutes,
  mountHtmlFallbackRoutes,
};
