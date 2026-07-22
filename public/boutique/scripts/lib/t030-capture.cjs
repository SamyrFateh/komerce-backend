'use strict';
/**
 * public/boutique/scripts/lib/t030-capture.cjs
 *
 * Driver de capture T-030 — version corrigée.
 * Déplacé hors de .agent/generated/ (scope tâche T-030) vers scripts/lib/
 * (scope boutique, versionné) car réutilisé comme dépendance CI par
 * public/boutique/scripts/gate-smoke-boutique.cjs (lot GATE-SMOKE-BOUTIQUE).
 */

const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const detailFixture = require('../../tests/fixtures/golden-elite-pro-detail.js');

const BASE_URL = process.env.T030_BASE_URL || 'http://127.0.0.1:4173/boutique/';
const EVIDENCE_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '.agent', 'evidence', 'T-030');
const CAPTURES_DIR = path.join(EVIDENCE_ROOT, 'captures');
const STATES_DIR = path.join(EVIDENCE_ROOT, 'states');

fs.mkdirSync(EVIDENCE_ROOT, { recursive: true });
for (const dir of [CAPTURES_DIR, STATES_DIR]) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

const VIEWPORTS = [
  ['360', 360, 800],
  ['390', 390, 844],
  ['430', 430, 932],
  ['1024', 1024, 768],
  ['1440', 1440, 900],
  ['1600', 1680, 1050],
];
const STATES = [
  'AVAILABLE_EMPTY',
  'AVAILABLE_FILLED',
  'OUT_OF_STOCK',
  'SELECTION_REQUIRED',
  'LOADING',
  'ERROR',
];

const GOLDEN_ID = detailFixture.product.id;
const GOLDEN_CATEGORY = detailFixture.product.category;
const goldenListItem = {
  id: GOLDEN_ID,
  reference: detailFixture.product.reference,
  name: detailFixture.product.name,
  category: GOLDEN_CATEGORY,
  price_kmf: detailFixture.pricing.price_kmf,
  old_price_kmf: detailFixture.pricing.old_price_kmf,
  promo_pct: detailFixture.pricing.promo_pct,
  image_url: detailFixture.media[0].url,
  has_variants: true,
  is_available: true,
};

function fillerListItem(n) {
  return {
    id: `t030-filler-${n}`,
    reference: `T030-FILLER-${n}`,
    name: `Article de remplissage T-030 #${n}`,
    category: GOLDEN_CATEGORY,
    price_kmf: 15000 + n * 1000,
    old_price_kmf: null,
    promo_pct: null,
    image_url: detailFixture.media[0].url,
    has_variants: false,
    is_available: true,
  };
}

const MOCK_CATALOG_LIST = [goldenListItem, fillerListItem(1), fillerListItem(2), fillerListItem(3)];

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function createLoadingControl() {
  return { requested: deferred(), release: deferred(), completed: deferred() };
}

function withTimeout(promise, ms, label) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} après ${ms} ms`)), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

function detailFor() {
  return clone(detailFixture);
}

async function installApi(page, state, log, loadingControl = null) {
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;

    if (/\/api\/products\/?$/.test(pathname)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          products: MOCK_CATALOG_LIST,
          total: MOCK_CATALOG_LIST.length,
          limit: 1000,
          offset: 0,
        }),
      });
    }

    if (pathname === `/api/products/${GOLDEN_ID}/detail`) {
      if (state === 'ERROR') {
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'T030 controlled failure' }),
        });
      }
      if (state === 'LOADING') {
        if (!loadingControl) throw new Error('LOADING control absent');
        loadingControl.requested.resolve();
        await loadingControl.release.promise;
      }
      const response = await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detailFor()),
      });
      if (state === 'LOADING') loadingControl.completed.resolve();
      return response;
    }

    if (pathname === '/api/categories') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }

    if (pathname === '/api/auth/me') {
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'unauthenticated' }),
      });
    }

    log.push(`[route:default-200] ${pathname} non géré explicitement, réponse {} renvoyée`);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function openPdp(page, state) {
  const listResponsePromise = page
    .waitForResponse((r) => new URL(r.url()).pathname === '/api/products')
    .catch(() => null);

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await listResponsePromise;

  const card = page.locator(`#k-grid .k-card[data-id="${GOLDEN_ID}"], #k-grid .k-promo-card[data-id="${GOLDEN_ID}"]`).first();
  await card.waitFor({ state: 'visible', timeout: 15_000 });
  await card.click();

  await page.locator('#k-modal-overlay.open, .k-modal-overlay.open')
    .waitFor({ state: 'visible', timeout: 8_000 });

  if (state === 'LOADING') {
    await page.locator('[data-mdm-skeleton="1"], .k-mdm-skeleton')
      .waitFor({ state: 'visible', timeout: 5_000 });
    return;
  }
  if (state === 'ERROR') {
    await page.locator('[data-mdm-detail-error="1"], .k-mdm-detail-error')
      .waitFor({ state: 'visible', timeout: 12_000 });
    return;
  }

  await page.locator('[data-axis-key] button[data-option-value]').first()
    .waitFor({ state: 'attached', timeout: 10_000 });

  if (state === 'SELECTION_REQUIRED') return;

  if (state === 'OUT_OF_STOCK') {
    await page.locator('[data-axis-key="Couleur"] button[data-option-value="Bleu"]').click();
    await page.locator('[data-axis-key="Taille"] button[data-option-value="43"]').click();
    return;
  }

  if (state === 'AVAILABLE_EMPTY') {
    await page.locator('[data-axis-key="Couleur"] button[data-option-value="Bleu"]').click();
    await page.locator('[data-axis-key="Taille"] button[data-option-value="42"]').click();
    return;
  }

  if (state === 'AVAILABLE_FILLED') {
    await page.locator('[data-axis-key="Couleur"] button[data-option-value="Bleu"]').click();
    await page.locator('[data-axis-key="Taille"] button[data-option-value="42"]').click();
    const addBtn = page.locator('#k-add-cart-btn');
    await addBtn.waitFor({ state: 'visible', timeout: 5_000 });
    await addBtn.click();
  }
}

async function snapshotState(page, vpName, state) {
  return page.evaluate(() => {
    const $ = (sel) => document.querySelector(sel);
    const isVisible = (el) => {
      if (!el) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return !el.hidden && style.display !== 'none' && style.visibility !== 'hidden'
        && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
    };
    const cards = document.querySelectorAll('#k-grid .k-card, #k-grid .k-promo-card').length;
    const addBtn = $('#k-add-cart-btn');
    const stock = $('#k-modal-stock');
    const message = $('#k-modal-selection-message');
    const skeleton = $('[data-mdm-skeleton="1"], .k-mdm-skeleton');
    const errorEl = $('[data-mdm-detail-error="1"], .k-mdm-detail-error');
    const selectedOptions = [...document.querySelectorAll('[data-axis-key] button[aria-pressed="true"]')]
      .map((button) => button.getAttribute('data-option-value'));
    const skeletonRect = skeleton ? skeleton.getBoundingClientRect() : null;
    return {
      cardsInGrid: cards,
      modalOpen: !!document.querySelector('#k-modal-overlay.open, .k-modal-overlay.open'),
      addCartBtn: addBtn ? {
        disabled: addBtn.disabled,
        inCart: addBtn.classList.contains('in-cart'),
        text: addBtn.textContent.trim(),
      } : null,
      selectedOptions,
      stockText: stock ? stock.textContent.trim() : null,
      selectionMessage: message ? message.textContent.trim() : null,
      skeletonVisible: isVisible(skeleton),
      skeletonHeight: skeletonRect ? skeletonRect.height : 0,
      errorVisible: isVisible(errorEl),
    };
  }).then((domState) => ({ viewport: vpName, state, timestamp: new Date().toISOString(), ...domState }));
}

function validateSnapshot(state, snapshot) {
  if (!snapshot.modalOpen || snapshot.cardsInGrid < 1) return false;
  if (state === 'LOADING') return snapshot.skeletonVisible && snapshot.skeletonHeight > 0;
  if (state === 'ERROR') return snapshot.errorVisible;
  if (!snapshot.addCartBtn) return false;
  if (state === 'SELECTION_REQUIRED') return snapshot.addCartBtn.disabled === true;
  if (state === 'OUT_OF_STOCK') {
    const text = `${snapshot.selectionMessage || ''} ${snapshot.stockText || ''}`;
    return snapshot.addCartBtn.disabled === true && /rupture|indisponible/i.test(text);
  }
  if (state === 'AVAILABLE_EMPTY') {
    return snapshot.selectedOptions.length >= 2
      && snapshot.addCartBtn.disabled === false
      && snapshot.addCartBtn.inCart === false;
  }
  if (state === 'AVAILABLE_FILLED') {
    return snapshot.selectedOptions.length >= 2 && snapshot.addCartBtn.inCart === true;
  }
  return false;
}

async function run() {
  const launchOpts = process.env.T030_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.T030_CHROMIUM_EXECUTABLE }
    : {};
  const browser = await chromium.launch(launchOpts);
  const results = [];
  let failures = 0;

  for (const [vpName, w, h] of VIEWPORTS) {
    for (const state of STATES) {
      const label = `${vpName}-${state}`;
      const log = [];
      const context = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
      await context.addInitScript(() => {
        try { window.localStorage.setItem('sw_reset_v334', '1'); } catch (_) {}
      });
      const page = await context.newPage();
      page.on('console', (m) => log.push(`[console:${m.type()}] ${m.text()}`));
      page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}`));
      page.on('requestfailed', (r) => log.push(`[reqfail] ${r.url()} ${r.failure() ? r.failure().errorText : ''}`));

      let entry = { viewport: vpName, state, ok: false };
      try {
        const loadingControl = state === 'LOADING' ? createLoadingControl() : null;
        await installApi(page, state, log, loadingControl);
        const openPromise = openPdp(page, state);
        openPromise.catch(() => {}); // évite un unhandled rejection si le garde LOADING rejette avant que openPromise soit awaited
        if (loadingControl) {
          await withTimeout(loadingControl.requested.promise, 10_000, 'requête /detail LOADING absente');
        }
        await openPromise;

        await page.screenshot({ path: path.join(CAPTURES_DIR, `${label}.png`), fullPage: false });
        const snapshot = await snapshotState(page, vpName, state);
        const ok = validateSnapshot(state, snapshot);
        if (!ok) {
          failures += 1;
          log.push(`[t030] validation d'état échouée: ${JSON.stringify(snapshot)}`);
          fs.writeFileSync(path.join(EVIDENCE_ROOT, `fail-${label}.log`), log.join('\n') || '(aucun log capturé)');
        }
        fs.writeFileSync(path.join(STATES_DIR, `${label}.json`), JSON.stringify(snapshot, null, 2) + '\n');
        entry = { ...snapshot, ok };

        if (loadingControl) {
          loadingControl.release.resolve();
          await withTimeout(loadingControl.completed.promise, 5_000, 'libération /detail LOADING incomplète');
        }
      } catch (error) {
        failures += 1;
        entry.error = error.message;
        fs.writeFileSync(
          path.join(EVIDENCE_ROOT, `fail-${label}.log`),
          (log.join('\n') || '(aucun log capturé)') + `\n[exception] ${error.stack}`,
        );
      } finally {
        await context.close();
      }
      results.push(entry);
    }
  }

  await browser.close();

  const matrixLines = [
    '| Viewport | ' + STATES.join(' | ') + ' |',
    '|---|' + STATES.map(() => '---').join('|') + '|',
  ];
  for (const [vpName] of VIEWPORTS) {
    const row = STATES.map((state) => {
      const result = results.find((item) => item.viewport === vpName && item.state === state);
      return result && result.ok ? '✅' : '❌';
    });
    matrixLines.push(`| ${vpName} | ${row.join(' | ')} |`);
  }
  fs.writeFileSync(path.join(EVIDENCE_ROOT, 'visual-comparison-matrix.md'), matrixLines.join('\n') + '\n');

  const pngCount = fs.readdirSync(CAPTURES_DIR).filter((name) => name.endsWith('.png')).length;
  const jsonCount = fs.readdirSync(STATES_DIR).filter((name) => name.endsWith('.json')).length;
  const report = {
    total: VIEWPORTS.length * STATES.length,
    ok: results.filter((result) => result.ok).length,
    failed: failures,
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    physicalCounts: { png: pngCount, json: jsonCount },
    fixApplied: 'Golden + 3 fillers, clics Playwright natifs, LOADING bloqué puis libéré explicitement, validation réelle de chaque état',
  };
  fs.writeFileSync(path.join(EVIDENCE_ROOT, 'visual-report.json'), JSON.stringify(report, null, 2) + '\n');

  console.log(`T-030 : ${report.ok}/${report.total}; ${pngCount} PNG + ${jsonCount} JSON`);
  if (report.ok !== 36 || pngCount !== 36 || jsonCount !== 36) {
    throw new Error(`T-030 incomplet: ${report.ok}/36 états valides, ${pngCount} PNG, ${jsonCount} JSON`);
  }
}

// Exécution CLI uniquement quand le script est lancé directement
// (`node public/boutique/scripts/lib/t030-capture.cjs`) — inchangée. Un
// `require()` par un autre runner (ex. gate-smoke-boutique.cjs) ne déclenche
// PAS run().
if (require.main === module) {
  run().catch((error) => {
    console.error('[t030-capture] échec fatal :', error);
    process.exitCode = 1;
  });
}

// Surface réutilisable pour les runners qui composent sur ce driver assaini
// (S1 GATE-SMOKE-BOUTIQUE : Parcours 1 & 2). Ne change rien au comportement
// CLI ci-dessus.
module.exports = {
  BASE_URL,
  VIEWPORTS,
  STATES,
  GOLDEN_ID,
  GOLDEN_CATEGORY,
  MOCK_CATALOG_LIST,
  detailFor,
  clone,
  installApi,
  openPdp,
  snapshotState,
  validateSnapshot,
  createLoadingControl,
  withTimeout,
};
