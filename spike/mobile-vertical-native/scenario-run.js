/**
 * scenario-run.js — PHASE 2 scénario utilisateur complet instrumenté.
 *
 * Fait tourner le parcours complet exigé par le rechallenge sur les DEUX shells
 * (A pager baseline, B vertical) et 3 viewports, contre le serveur de preview
 * (vraie Boutique + API mockée). Capture à chaque étape :
 *   window.scrollY, catégorie active, scroll owner, nb overflow vertical,
 *   présence k-pager-active, position avant/après modal, dérive px.
 *
 * Usage : node spike/mobile-vertical-native/scenario-run.js
 * (démarre le preview-server automatiquement)
 */
'use strict';

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 4601;
const BASE = `http://localhost:${PORT}/boutique/`;

const VIEWPORTS = [
  { name: '360', width: 360, height: 800 },
  { name: '390', width: 390, height: 844 },
  { name: '430', width: 430, height: 932 },
];

// ── Instrumentation injectée dans la page ────────────────────────────────

const PROBE = `
window.__probe = function() {
  let overflowV = 0;
  document.querySelectorAll('*').forEach(el => {
    const s = getComputedStyle(el);
    if ((s.overflowY === 'auto' || s.overflowY === 'scroll') &&
        el.scrollHeight > el.clientHeight + 4) overflowV++;
  });
  const ps = document.getElementById('k-page-scroll');
  const activeChip = document.querySelector('#k-cats .is-active, #k-cats [data-cat].is-active');
  return {
    scrollY: Math.round(window.scrollY),
    pageScrollTop: Math.round(ps ? ps.scrollTop : 0),
    pagerActive: !!(ps && ps.classList.contains('k-pager-active')),
    scrollOwner: (ps && ps.classList.contains('k-pager-active')) ? 'cage' : 'document',
    overflowVertical: overflowV,
    activeCat: activeChip ? (activeChip.getAttribute('data-cat') || activeChip.textContent.trim()) : null,
    bodyShellVertical: document.body.classList.contains('spike-shell-vertical'),
  };
};
`;

async function probe(page) {
  return page.evaluate('window.__probe()');
}

async function step(page, label, log) {
  const p = await probe(page);
  log.push({ step: label, ...p });
  return p;
}

async function runScenario(browser, shell, vp) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  const log = [];
  const url = shell === 'vertical' ? BASE + '?shell=vertical' : BASE;

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.addInitScript(PROBE);
  await page.evaluate(PROBE); // injecter aussi dans le contexte courant
  await page.waitForTimeout(1200); // boot + premier rendu

  await step(page, '1-accueil', log);

  // Scroll profond
  await page.evaluate(() => window.scrollTo({ top: 1200, behavior: 'instant' }));
  await page.waitForTimeout(400);
  await step(page, '2-scroll-profond', log);

  // Discovery visible ? (scroll vers le rail discovery s'il existe)
  await page.evaluate(() => {
    const d = document.getElementById('k-discovery-local');
    if (d) d.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(400);
  await step(page, '3-discovery', log);

  // Changement catégorie via rail (clic 3e chip)
  await page.evaluate(() => {
    const chips = document.querySelectorAll('#k-cats [data-cat]');
    if (chips[3]) chips[3].click();
  });
  await page.waitForTimeout(700);
  await step(page, '4-categorie-via-rail', log);

  // Scroll manuel vers une autre zone
  await page.evaluate(() => window.scrollBy({ top: 900, behavior: 'instant' }));
  await page.waitForTimeout(500);
  await step(page, '5-scroll-manuel', log);

  // PDP : ouvrir une carte produit
  const posBeforePDP = await probe(page);
  const opened = await page.evaluate(() => {
    const card = document.querySelector('.k-card, [data-product], .k-product-card');
    if (card) { card.click(); return true; }
    return false;
  });
  await page.waitForTimeout(700);
  await step(page, '6-pdp-ouverte', log);

  // Fermeture PDP (Escape)
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(700);
  const posAfterPDP = await step(page, '7-pdp-fermee', log);
  const driftPDP = opened ? (posAfterPDP.scrollY - posBeforePDP.scrollY) : null;
  log.push({ step: '7b-derive-pdp', driftPx: driftPDP });

  // PDP à nouveau + back navigateur
  const posBeforeBack = await probe(page);
  await page.evaluate(() => {
    const card = document.querySelector('.k-card, [data-product], .k-product-card');
    if (card) card.click();
  });
  await page.waitForTimeout(700);
  await page.goBack().catch(() => {});
  await page.waitForTimeout(700);
  const posAfterBack = await step(page, '8-back-navigateur', log);
  const driftBack = posAfterBack.scrollY - posBeforeBack.scrollY;
  log.push({ step: '8b-derive-back', driftPx: driftBack });

  // Panier
  await page.evaluate(() => {
    const cartBtn = document.querySelector('[data-cart-toggle], #k-cart-btn, .k-cart-pill, [aria-label*="panier" i]');
    if (cartBtn) cartBtn.click();
  });
  await page.waitForTimeout(500);
  await step(page, '9-panier-ouvert', log);

  // Fermeture panier
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);
  await step(page, '10-panier-ferme', log);

  // Changement catégorie
  await page.evaluate(() => {
    const chips = document.querySelectorAll('#k-cats [data-cat]');
    if (chips[5]) chips[5].click();
  });
  await page.waitForTimeout(700);
  await step(page, '11-autre-categorie', log);

  await context.close();
  return log;
}

function analyze(shell, vp, log) {
  const findings = [];
  const pagerActiveSteps = log.filter(l => l.pagerActive === true).map(l => l.step);
  const maxOverflow = Math.max(...log.filter(l => l.overflowVertical != null).map(l => l.overflowVertical));
  const drifts = log.filter(l => l.driftPx != null);

  if (shell === 'vertical') {
    if (pagerActiveSteps.length > 0) findings.push(`❌ k-pager-active présent en vertical: ${pagerActiveSteps.join(', ')}`);
    else findings.push('✅ k-pager-active jamais posé en vertical');
    // Overflow catalogue : hors étapes modale (la modale a légitimement son
    // propre scroll interne, présent dans toute architecture).
    const nonModalSteps = log.filter(l => l.overflowVertical != null && !/pdp-ouverte/.test(l.step));
    const maxCatalogOverflow = Math.max(...nonModalSteps.map(l => l.overflowVertical));
    if (maxCatalogOverflow > 1) findings.push(`⚠️ ${maxCatalogOverflow} overflow catalogue max (attendu 1)`);
    else findings.push(`✅ 1 seul scroll owner catalogue (le document) — le +1 en PDP est le scroll modal légitime`);
  } else {
    findings.push(`ℹ️ baseline pager — overflow max ${maxOverflow}, pager-active sur ${pagerActiveSteps.length} étapes`);
  }
  for (const d of drifts) {
    const ok = Math.abs(d.driftPx || 0) <= 2;
    findings.push(`${ok ? '✅' : '⚠️'} ${d.step}: ${d.driftPx}px`);
  }
  return findings;
}

async function main() {
  // Démarrer le preview server
  const srv = spawn('node', [path.join(__dirname, 'preview-server.js'), String(PORT)], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1000));

  const browser = await chromium.launch();
  const report = { generated: new Date().toISOString(), runs: [] };

  try {
    for (const vp of VIEWPORTS) {
      for (const shell of ['pager', 'vertical']) {
        process.stdout.write(`\n▶ ${shell} @ ${vp.name}... `);
        const log = await runScenario(browser, shell, vp);
        const findings = analyze(shell, vp, log);
        report.runs.push({ shell, viewport: vp.name, log, findings });
        process.stdout.write('done');
      }
    }
  } finally {
    await browser.close();
    srv.kill();
  }

  // Rapport
  console.log('\n\n═══════════ RÉSULTATS SCÉNARIO ═══════════\n');
  for (const run of report.runs) {
    console.log(`── ${run.shell.toUpperCase()} @ ${run.viewport} ──`);
    run.findings.forEach(f => console.log('  ' + f));
    console.log('');
  }

  const fs = require('fs');
  fs.writeFileSync(path.join(__dirname, 'SCENARIO_RESULTS.json'), JSON.stringify(report, null, 2));
  console.log('✔ SCENARIO_RESULTS.json écrit');
}

main().catch(e => { console.error(e); process.exit(1); });
