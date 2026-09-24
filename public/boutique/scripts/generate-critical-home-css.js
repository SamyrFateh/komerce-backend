/**
 * @komerce-arch-lite
 * @role          critical-home-css-generator
 * @domain        boutique
 * @layer         build-tool
 * @owner         public/boutique/css/critical-home.css
 * @purpose       Régénère css/critical-home.css à partir d'une mesure de
 *                couverture CSS réelle (Chrome DevTools Coverage via
 *                Playwright) sur la page d'accueil, mobile et desktop.
 *                Manuel, jamais exécuté automatiquement — à relancer quand
 *                l'accueil change significativement (GAP-F4 étape 2,
 *                docs/gaps/GAP_BOUTIQUE_FRONTEND_CORRECTIONS.md).
 * @requires      Un serveur Komerce local démarré (localhost:3000) avec un
 *                catalogue non vide sur plusieurs rayons.
 * @usage         node scripts/generate-critical-home-css.js [url]
 * @version       2026-09
 */
'use strict';

const { chromium } = require('@playwright/test');
const postcss = require('postcss');
const fs = require('fs');
const path = require('path');

const URL = process.argv[2] || 'http://localhost:3000/boutique.html';
const OUT_FILE = path.join(__dirname, '..', 'css', 'critical-home.css');

function mergeRanges(ranges) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged = [];
  for (const { start, end } of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

function overlaps(nodeStart, nodeEnd, ranges) {
  return ranges.some(([s, e]) => nodeStart < e && nodeEnd > s);
}

function extractCritical(cssText, ranges) {
  const root = postcss.parse(cssText);
  const criticalRoot = postcss.root();
  root.each((node) => {
    if (node.type === 'atrule' && node.name === 'media') {
      const kept = [];
      node.each((child) => {
        const start = child.source.start.offset;
        const end = child.source.end.offset + 1;
        if (overlaps(start, end, ranges)) kept.push(child.clone());
      });
      if (kept.length) {
        const newMedia = postcss.atRule({ name: 'media', params: node.params });
        kept.forEach((c) => newMedia.append(c));
        criticalRoot.append(newMedia);
      }
    } else if (node.type === 'rule' || (node.type === 'atrule' && node.name !== 'media')) {
      const start = node.source.start.offset;
      const end = node.source.end.offset + 1;
      if (overlaps(start, end, ranges)) criticalRoot.append(node.clone());
    }
  });
  return criticalRoot.toString();
}

async function measureOnePage(browser, viewport, isMobile) {
  const ctx = await browser.newContext({ viewport, isMobile });
  const page = await ctx.newPage();
  await page.coverage.startCSSCoverage({ resetOnNavigation: false });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);
  // Défilement complet de la page d'accueil pour couvrir les sections basses,
  // sans ouvrir de modale/panier/checkout (hors périmètre du critique).
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 800);
    await page.waitForTimeout(300);
  }
  const coverage = await page.coverage.stopCSSCoverage();
  await ctx.close();
  return coverage.find((c) => c.url.includes('components.css'));
}

(async () => {
  const browser = await chromium.launch();
  const mobile = await measureOnePage(browser, { width: 390, height: 844 }, true);
  const desktop = await measureOnePage(browser, { width: 1440, height: 900 }, false);
  await browser.close();

  if (!mobile || !desktop) {
    console.error('components.css introuvable dans la couverture — le serveur sert-il bien la page ?');
    process.exit(1);
  }
  if (mobile.text !== desktop.text) {
    console.error('Le contenu de components.css diffère entre les deux mesures — annulé.');
    process.exit(1);
  }

  const merged = mergeRanges([...mobile.ranges, ...desktop.ranges]);
  const critical = extractCritical(mobile.text, merged);

  const openBraces = (critical.match(/{/g) || []).length;
  const closeBraces = (critical.match(/}/g) || []).length;
  if (openBraces !== closeBraces) {
    console.error(`CSS généré déséquilibré (${openBraces} vs ${closeBraces}) — annulé, rien écrit.`);
    process.exit(1);
  }

  const header = `/**
 * @komerce-arch-lite
 * @role          critical-home-css-snapshot
 * @domain        boutique
 * @layer         css
 * @purpose       Sous-ensemble de components.css réellement utilisé pour
 *                afficher l'accueil (mesuré par couverture CSS réelle du
 *                navigateur), chargé de façon bloquante avant components.css
 *                (qui reste intact mais chargé en preload non bloquant —
 *                GAP-F4 étape 2, docs/gaps/GAP_BOUTIQUE_FRONTEND_CORRECTIONS.md).
 * @provenance    Régénéré le ${new Date().toISOString().slice(0, 10)} via
 *                scripts/generate-critical-home-css.js (Playwright
 *                CSSCoverage, mobile 390×844 + desktop 1440×900, défilement
 *                complet, sans modale/panier/checkout).
 * @regenerate    node scripts/generate-critical-home-css.js
 *                À relancer si l'accueil change significativement.
 * @warning       Fichier généré, additif : ne JAMAIS retirer de règle de
 *                components.css sur la foi de ce fichier.
 * @version       2026-09
 */

`;

  fs.writeFileSync(OUT_FILE, header + critical);
  console.log(`css/critical-home.css régénéré : ${critical.length} octets, ${openBraces} règles équilibrées.`);
})();
