/**
 * preview-server.js — PHASE 2 preview local (spike, jamais mergé).
 *
 * Sert la vraie Boutique (public/boutique/) + un stub /api/ avec produits
 * mockés, pour que le shell vertical boote RÉELLEMENT avec des produits
 * cliquables. Permet à Playwright de tourner le scénario utilisateur complet
 * en mode B (?shell=vertical) sans backend/DB réels.
 *
 * Ce n'est PAS le staging distant (hors de portée sans déploiement de la
 * branche spike), mais c'est la preuve la plus proche : vrai DOM, vrais
 * modules, vrai cycle modal, seuls les DONNÉES sont mockées.
 *
 * Usage : node spike/mobile-vertical-native/preview-server.js [port]
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.argv[2]) || 4599;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

// ── Produits mockés (structure identique au contrat catalogue) ───────────

const CATEGORIES = ['mode', 'maison', 'tech', 'bricolage', 'beaute', 'supermarche', 'sport', 'auto'];

function mockProducts() {
  const out = [];
  let id = 1;
  for (const cat of CATEGORIES) {
    const n = 6 + (id % 8); // catégories de tailles variables
    for (let i = 0; i < n; i++) {
      out.push({
        id: `mock-${id}`,
        name: `Produit ${cat} ${i + 1}`,
        category: cat,
        price_kmf: 5000 + (id * 1500) % 40000,
        image_url: '',
        is_available: true,
        is_active: true,
      });
      id++;
    }
  }
  return out;
}

const PRODUCTS = mockProducts();

function sendJson(res, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(200, { 'Content-Type': MIME['.json'] });
  res.end(body);
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/' || urlPath === '/boutique' || urlPath === '/boutique/') {
    urlPath = '/boutique/index.html';
  }
  const filePath = path.join(PUBLIC, urlPath);
  // Sécurité : rester sous PUBLIC
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404); res.end('Not found: ' + urlPath); return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  // ── Stubs API minimaux ──
  if (url === '/api/products' || url.startsWith('/api/products?')) {
    return sendJson(res, { products: PRODUCTS });
  }
  if (url.match(/^\/api\/products\/[^/]+\/detail$/)) {
    const id = url.split('/')[3];
    const p = PRODUCTS.find(x => x.id === id) || PRODUCTS[0];
    return sendJson(res, {
      ...p,
      description: `Description de ${p.name}. Livraison disponible.`,
      delivery_options: [],
      variants: [],
      images: [],
    });
  }
  if (url.startsWith('/api/boutique/suggestions')) {
    // Discovery « Près de vous » — 3 kinds
    return sendJson(res, {
      surface: 'local',
      cards: [
        { kind: 'product', title: 'Chaussure Elite Pro', subtitle: 'Disponible maintenant', cta_label: 'Acheter', cta_action_ref: 'mock-1', image_ref: '', price: 19900, zone: null, provider_name: null },
        { kind: 'physical_offer', title: 'Samboussas au bœuf', subtitle: 'Préparation sur commande', cta_label: 'Commander', cta_action_ref: 'off-1', image_ref: '', price: null, zone: 'Moroni', provider_name: 'Chez Fati' },
        { kind: 'service', title: 'Installation climatiseur', subtitle: 'Sur demande', cta_label: 'Demander', cta_action_ref: 'svc-1', image_ref: '', price: null, zone: 'Mutsamudu', provider_name: 'Bâtir Anjouan' },
      ],
    });
  }
  if (url.startsWith('/api/local-stock/availability')) {
    return sendJson(res, { available: true, qty: 10 });
  }
  if (url.startsWith('/api/config') || url.startsWith('/api/market')) {
    return sendJson(res, { market: 'KM', currency: 'KMF' });
  }
  if (url.startsWith('/api/')) {
    // Tout autre endpoint → 200 vide (le shell dégrade proprement)
    return sendJson(res, {});
  }

  // ── Statique ──
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`[preview] Boutique spike servie sur http://localhost:${PORT}/boutique/`);
  console.log(`[preview]   pager   (A) : http://localhost:${PORT}/boutique/`);
  console.log(`[preview]   vertical(B) : http://localhost:${PORT}/boutique/?shell=vertical`);
  console.log(`[preview] ${PRODUCTS.length} produits mockés, ${CATEGORIES.length} catégories`);
});
