/**
 * @e2e legacy-theme-audit.spec.js
 * @feature dashboard
 * @brief Mesure Playwright du thème Legacy réel (control-tower.html + PIL_STYLES).
 *        Produit un rapport JSON de computed styles et une capture 1672×941.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const ROOT = path.join(__dirname, '..', '..');
const LEGACY = path.join(ROOT, 'public', 'dashboards', 'admin-legacy');
const ORIGIN = 'http://komerce.test';

const htmlSource = fs.readFileSync(path.join(LEGACY, 'control-tower.html'), 'utf8');
const shellStyle = (htmlSource.match(/<style>([\s\S]*?)<\/style>/) || [,''])[1];

const pilotageSource = fs.readFileSync(path.join(LEGACY, 'js', 'ct-views-pilotage.js'), 'utf8');
const pilotageStyle = (pilotageSource.match(/const PIL_STYLES = \`([\s\S]*?)\`;/) || [,''])[1];

const fixture = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<style>${shellStyle}</style>
<style>${pilotageStyle}</style>
</head>
<body>
<div id="bo-app" style="display:flex">
  <nav class="ct-sidebar" data-shell="ct">
    <div class="ct-sidebar-header">
      <div class="ct-logo">🗼 Tour de Contrôle</div>
      <div class="ct-shell-desc">Signal · Synthèse · Arbitrage · Décision</div>
    </div>
    <div class="ct-shell-switcher">
      <button class="ct-shell-tab active">CT</button>
      <button class="ct-shell-tab">BO</button>
    </div>
    <div class="ct-sidebar-nav">
      <div class="ct-section-title">Pilotage</div>
      <button class="ct-nav-item active"><span class="ct-nav-emoji">📈</span><span class="ct-nav-label">Pilotage</span></button>
      <button class="ct-nav-item"><span class="ct-nav-emoji">⚠️</span><span class="ct-nav-label">Problèmes</span></button>
    </div>
    <div class="ct-sidebar-footer">
      <div id="ct-user-name">Admin</div>
      <div class="ct-user-role">ADMIN</div>
    </div>
  </nav>

  <main class="ct-main">
    <div class="ct-view-header">
      <h2>📈 Pilotage Stratégique</h2>
      <p class="ct-subtitle">Cockpit de pilotage — vue legacy réelle</p>
    </div>

    <div class="pil-tabs">
      <div class="pil-tab active">Dashboard Live</div>
      <div class="pil-tab">Opérationnel</div>
    </div>

    <div class="ct-kpi-grid">
      <div class="ct-kpi"><div class="ct-kpi-icon">⚠️</div><div><div class="ct-kpi-value">7</div><div class="ct-kpi-label">Critiques</div></div></div>
      <div class="ct-kpi"><div class="ct-kpi-icon">📦</div><div><div class="ct-kpi-value">128</div><div class="ct-kpi-label">Commandes</div></div></div>
    </div>

    <div class="pil-metric-grid">
      <div class="pil-metric">
        <div class="pil-metric-label">Marge nette</div>
        <div class="pil-metric-val amber">12,4%</div>
        <div class="pil-metric-sub">sur 30 jours</div>
      </div>
      <div class="pil-metric">
        <div class="pil-metric-label">Commandes actives</div>
        <div class="pil-metric-val blue">128</div>
        <div class="pil-metric-sub">flux global</div>
      </div>
    </div>

    <section class="ct-section-block pil-section">
      <h3>Chaîne opérationnelle</h3>
      <div class="pil-pipeline">
        <div class="pil-pipeline-step"><div class="pil-pipeline-label">Commande</div><div class="pil-pipeline-val">128</div></div>
        <div class="pil-pipeline-step"><div class="pil-pipeline-label">Achats</div><div class="pil-pipeline-val">96</div></div>
        <div class="pil-pipeline-step"><div class="pil-pipeline-label">Hub</div><div class="pil-pipeline-val">72</div></div>
      </div>
      <div class="pil-alert pil-alert-err">Paiement fournisseur bloqué</div>
      <div class="pil-alert pil-alert-warn">Transport à surveiller</div>
      <div class="pil-alert pil-alert-ok">Contrôle Hub sain</div>
    </section>

    <section class="ct-section-block">
      <h3>Table</h3>
      <table class="ct-table"><thead><tr><th>Commande</th><th>État</th></tr></thead><tbody><tr><td>KOM-001</td><td>En transit</td></tr></tbody></table>
    </section>
  </main>
</div>
</body>
</html>`;

function pick(cs) {
  return {
    backgroundColor: cs.backgroundColor,
    color: cs.color,
    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    lineHeight: cs.lineHeight,
    borderColor: cs.borderColor,
    borderWidth: cs.borderWidth,
    borderRadius: cs.borderRadius,
    boxShadow: cs.boxShadow,
    padding: cs.padding,
  };
}

test('mesure le thème Legacy réel', async ({ page }, testInfo) => {
  await page.route(`${ORIGIN}/legacy-theme`, route => route.fulfill({
    contentType: 'text/html',
    body: fixture,
  }));

  await page.setViewportSize({ width: 1672, height: 941 });
  await page.goto(`${ORIGIN}/legacy-theme`);

  const report = await page.evaluate(() => {
    const read = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        selector,
        backgroundColor: cs.backgroundColor,
        backgroundImage: cs.backgroundImage,
        color: cs.color,
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight,
        letterSpacing: cs.letterSpacing,
        borderColor: cs.borderColor,
        borderWidth: cs.borderWidth,
        borderRadius: cs.borderRadius,
        boxShadow: cs.boxShadow,
        padding: cs.padding,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    };

    return {
      viewport: { width: innerWidth, height: innerHeight },
      body: read('body'),
      sidebar: read('.ct-sidebar'),
      logo: read('.ct-logo'),
      sectionTitle: read('.ct-section-title'),
      navItem: read('.ct-nav-item'),
      navActive: read('.ct-nav-item.active'),
      main: read('.ct-main'),
      viewTitle: read('.ct-view-header h2'),
      subtitle: read('.ct-subtitle'),
      shellTab: read('.ct-shell-tab'),
      shellTabActive: read('.ct-shell-tab.active'),
      genericKpi: read('.ct-kpi'),
      genericKpiValue: read('.ct-kpi-value'),
      genericKpiLabel: read('.ct-kpi-label'),
      pilotageTab: read('.pil-tab'),
      pilotageTabActive: read('.pil-tab.active'),
      pilotageMetric: read('.pil-metric'),
      pilotageMetricLabel: read('.pil-metric-label'),
      pilotageMetricValue: read('.pil-metric-val'),
      pilotageMetricSub: read('.pil-metric-sub'),
      sectionBlock: read('.ct-section-block'),
      sectionHeading: read('.pil-section h3'),
      pipelineStep: read('.pil-pipeline-step'),
      pipelineLabel: read('.pil-pipeline-label'),
      pipelineValue: read('.pil-pipeline-val'),
      alertError: read('.pil-alert-err'),
      alertWarn: read('.pil-alert-warn'),
      alertOk: read('.pil-alert-ok'),
      tableHeader: read('.ct-table th'),
      tableCell: read('.ct-table td'),
    };
  });

  console.log('[legacy-theme-audit] ' + JSON.stringify(report));
  await testInfo.attach('legacy-theme-audit.json', {
    body: Buffer.from(JSON.stringify(report, null, 2)),
    contentType: 'application/json',
  });
  await page.screenshot({
    path: testInfo.outputPath('legacy-theme-1672x941.png'),
    fullPage: false,
  });

  expect(report.body.backgroundColor).toBe('rgb(241, 245, 249)');
  expect(report.sidebar.backgroundColor).toBe('rgb(15, 23, 42)');
  expect(report.genericKpi.backgroundColor).toBe('rgb(255, 255, 255)');
  expect(report.sectionBlock.backgroundColor).toBe('rgb(255, 255, 255)');
  expect(report.pilotageMetric.backgroundColor).toBe('rgb(255, 255, 255)');
});
