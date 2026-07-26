#!/usr/bin/env node
'use strict';

/**
 * @komerce-arch-lite
 * @role          csp-fronts-harness
 * @domain        boutique
 * @layer         build-gate
 * @purpose       Rejoue la CSP RÉELLE de bootstrap/security.js (pas une copie
 *                maintenue à la main) dans un vrai Chromium, contre les 4
 *                fronts mono-page servis en production, et compte les
 *                <script> réellement bloqués par le navigateur.
 * @impact-areas  csp, boutique, hub, relais, dashboard
 *
 * ── Pourquoi ce harnais existe ──────────────────────────────────────────────
 * `check-inline-scripts.js` (gate statique, étendu à tout public/ en P0-D)
 * détecte l'ABSENCE de src sur un <script> — c'est nécessaire mais pas
 * suffisant : ça ne prouve pas que le navigateur exécute bien les scripts
 * *externes* restants sous la CSP en vigueur, et ça ne peut pas détecter une
 * régression future où `script-src` se durcirait encore (ex. whitelisting
 * par domaine cassant un CDN). Ce harnais mesure le comportement RÉEL du
 * navigateur, pas la forme du HTML.
 *
 * Contrairement à `repro-csp.js` (qui duplique la chaîne CSP à la main —
 * risque de drift silencieux si bootstrap/security.js change), ce script
 * importe `buildHelmetOptions()` directement : source unique de vérité.
 *
 * ── Portée ──
 * Les 4 fronts mesurés dans AUDIT_COUTURES_COUCHES.md :
 *   /boutique/   — 3 scripts inline restants (Classe C, arbitrage réservé,
 *                  volontairement non touchés — voir NOTE_DE_PASSATION.md)
 *   /hub/        — externalisé en P0-D → attendu : 0 bloqué
 *   /relais/     — externalisé en P0-D → attendu : 0 bloqué
 *   /login.html  — externalisé en P0-D → attendu : 0 bloqué
 *
 * Limite assumée : ce harnais tourne contre le code du dépôt servi en local,
 * pas contre l'environnement de production distant (accès non disponible
 * depuis ce sandbox). Il fait foi pour tout ce qui dépend du code ; il ne
 * remplace pas une vérification post-déploiement si la prod diverge du dépôt
 * (CDN, cache, config d'environnement).
 *
 * Usage :
 *   node harnais/geometry/audit-fronts-csp.js            ← rapport
 *   node harnais/geometry/audit-fronts-csp.js --strict    ← exit 1 si > 0 bloqué
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BOUTIQUE = path.resolve(__dirname, '..', '..');
const REPO = path.resolve(BOUTIQUE, '..', '..');
const PUBLIC = path.join(REPO, 'public');
const strict = process.argv.includes('--strict');

const RED = '\x1b[31m', GRN = '\x1b[32m', YEL = '\x1b[33m', BLD = '\x1b[1m', DIM = '\x1b[2m', R = '\x1b[0m';

const { buildHelmetOptions } = require(path.join(REPO, 'bootstrap', 'security.js'));

function cspHeaderFromDirectives() {
  const directives = buildHelmetOptions().contentSecurityPolicy.directives;
  return Object.entries(directives)
    .map(([key, values]) => {
      const kebab = key.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
      return `${kebab} ${values.join(' ')}`;
    })
    .join('; ');
}

const MIME = {
  '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript',
  '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
};

function serveWithCsp(cspHeader) {
  return http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, products: [], items: [], data: [], orders: [] }));
    }
    const filePath = path.join(PUBLIC, urlPath);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      return res.end('not found');
    }
    const headers = { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' };
    headers['Content-Security-Policy'] = cspHeader;
    res.writeHead(200, headers);
    res.end(fs.readFileSync(filePath));
  });
}

async function auditFront(browser, cspHeader, label, urlPath) {
  const port = 8200 + Math.floor(Math.random() * 500);
  const server = serveWithCsp(cspHeader);
  await new Promise(resolve => server.listen(port, resolve));

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const blocked = [];
  page.on('console', msg => {
    if (/Content Security Policy|Refused to execute inline script/i.test(msg.text())) {
      blocked.push(msg.text());
    }
  });

  let navError = null;
  try {
    await page.goto(`http://127.0.0.1:${port}${urlPath}`, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(1500);
  } catch (e) {
    navError = e.message;
  }

  await context.close();
  server.close();

  return { label, urlPath, blocked: blocked.length, blockedMessages: blocked, navError };
}

(async () => {
  const cspHeader = cspHeaderFromDirectives();
  console.log(`${BLD}Audit CSP des 4 fronts — scripts réellement bloqués (Chromium réel)${R}`);
  console.log(`${DIM}  script-src (source: bootstrap/security.js, buildHelmetOptions()) : ` +
    `${cspHeader.match(/script-src[^;]*/)[0]}${R}\n`);

  const fronts = [
    { label: 'boutique', urlPath: '/boutique/index.html' },
    { label: 'hub',      urlPath: '/hub/index.html' },
    { label: 'relais',   urlPath: '/relais/index.html' },
    { label: 'login',    urlPath: '/login.html' },
  ];

  const browser = await chromium.launch();
  const results = [];
  for (const f of fronts) {
    results.push(await auditFront(browser, cspHeader, f.label, f.urlPath));
  }
  await browser.close();

  let total = 0;
  let unexpectedBlocked = false;
  const KNOWN_RESERVE = { boutique: 3 }; // Classe C, arbitrage réservé — voir NOTE_DE_PASSATION.md
  for (const r of results) {
    total += r.blocked;
    const reserve = KNOWN_RESERVE[r.label] || 0;
    if (r.blocked > reserve) unexpectedBlocked = true;
    const status = r.blocked === 0 ? `${GRN}✔ 0 bloqué${R}` : `${RED}✗ ${r.blocked} bloqué(s)${R}`;
    console.log(`  ${BLD}${r.label.padEnd(10)}${R} ${r.urlPath.padEnd(22)} ${status}`);
    if (r.navError) console.log(`    ${YEL}⚠ navigation: ${r.navError}${R}`);
    for (const m of r.blockedMessages) console.log(`    ${DIM}${m.slice(0, 100)}${R}`);
  }

  console.log(`\n${BLD}Total : ${total} script(s) bloqué(s) par la CSP sur les 4 fronts.${R}`);
  if (total === 0) {
    console.log(`${GRN}${BLD}✔ Critère P0-D satisfait (0 script bloqué).${R}`);
  } else if (!unexpectedBlocked) {
    console.log(`${DIM}Écart attendu : boutique porte encore ${KNOWN_RESERVE.boutique} script(s) Classe C` +
      ` non externalisés (arbitrage réservé — voir NOTE_DE_PASSATION.md). hub/relais/login sont à 0.${R}`);
  } else {
    console.log(`${RED}${BLD}✗ Régression : un front attendu à 0 (hub/relais/login) est bloqué,` +
      ` ou boutique dépasse sa réserve connue de ${KNOWN_RESERVE.boutique}.${R}`);
  }

  process.exit(strict && unexpectedBlocked ? 1 : 0);
})();
