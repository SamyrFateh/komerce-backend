/**
 * @e2e   product-detail-pdc.spec.js
 * @feature catalog, modal-product
 * @brief Clôture PDC-8 : catalogue canonique réel → contrat détail → sélection SKU → parité responsive
 */
'use strict';

const { test, expect } = require('@playwright/test');
const {
  BASE_URL,
  waitForGrid,
  waitForModalOpen,
  IS_REMOTE,
} = require('./helpers/boutique.helpers');

const CARD_SELECTOR = '#k-grid .k-promo-card, #k-grid .k-card';
const PDC_PROJECTS = new Set(['Desktop Chrome', 'Mobile Chrome']);
const SKU_DISCOVERY_BATCH_SIZE = 12;

function escapeAttr(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function cardSelector(productId) {
  const id = escapeAttr(productId);
  return `#k-grid .k-promo-card[data-id="${id}"], #k-grid .k-card[data-id="${id}"]`;
}

function optionSelector(axisKey, optionValue) {
  return `[data-axis-key="${escapeAttr(axisKey)}"] button[data-option-value="${escapeAttr(optionValue)}"]`;
}

function kmfNumber(text) {
  const digits = String(text || '').replace(/[^0-9]/g, '');
  return digits ? Number(digits) : null;
}

function targetAvailableUnit(detail) {
  if (!detail || detail.inventory_model !== 'SKU') return null;
  if (!Array.isArray(detail.option_axes) || detail.option_axes.length === 0) return null;
  if (!Array.isArray(detail.sellable_units) || detail.sellable_units.length === 0) return null;

  return detail.sellable_units.find((unit) =>
    unit
    && unit.stock_status === 'AVAILABLE'
    && Number(unit.available_quantity) > 0
    && detail.option_axes.every((axis) =>
      Object.prototype.hasOwnProperty.call(unit.option_values || {}, axis.key)
    )
  ) || null;
}

async function fetchProductDetails(page, productIds) {
  return page.evaluate(async (ids) => Promise.all(ids.map(async (id) => {
    try {
      const response = await fetch(`/api/products/${encodeURIComponent(id)}/detail`, {
        credentials: 'include',
      });
      if (!response.ok) return { productId: id, detail: null };
      return { productId: id, detail: await response.json() };
    } catch (_) {
      return { productId: id, detail: null };
    }
  })), productIds);
}

async function discoverRealSkuProduct(page) {
  await waitForGrid(page);
  const productIds = await page.locator(CARD_SELECTOR).evaluateAll((cards) => [
    ...new Set(cards.map((card) => card.getAttribute('data-id')).filter(Boolean)),
  ]);

  for (let offset = 0; offset < productIds.length; offset += SKU_DISCOVERY_BATCH_SIZE) {
    const batch = productIds.slice(offset, offset + SKU_DISCOVERY_BATCH_SIZE);
    const results = await fetchProductDetails(page, batch);

    for (const { productId, detail } of results) {
      const unit = targetAvailableUnit(detail);
      if (unit) return { productId, detail, unit };
    }
  }

  return null;
}

async function openCandidate(page, candidate, testInfo) {
  const card = page.locator(cardSelector(candidate.productId)).first();
  await expect(card, `carte produit ${candidate.productId}`).toBeVisible({ timeout: 5_000 });
  await card.scrollIntoViewIfNeeded();

  if (testInfo) await captureStockDiagnostics(page, testInfo, '00-before-open');

  await card.click();
  await waitForModalOpen(page);

  if (testInfo) await captureStockDiagnostics(page, testInfo, '00b-after-open');

  const viewport = page.viewportSize();
  const isMobile = viewport ? viewport.width < 900 : false;
  const root = isMobile ? '[data-pdc4-root="1"]' : '[data-pdc5-root="1"]';
  await expect(page.locator(root)).toBeVisible({ timeout: 8_000 });
}

/**
 * DIAG-STOCK — instrumentation E-PDC-2. Capture l'état DOM autour de
 * #k-modal-stock à un point donné, sans influer sur le flux du test.
 * Attaché au rapport Playwright via testInfo.attach (visible même si le
 * test réussit, pour audit).
 */
async function captureStockDiagnostics(page, testInfo, checkpoint) {
  const diag = await page.evaluate(() => {
    const stockEl = document.querySelector('#k-modal-stock');
    const metaEl = document.querySelector('.k-modal-meta');
    const byIdSubstr = Array.from(document.querySelectorAll('[id*="stock"]')).map((el) => ({
      tag: el.tagName,
      id: el.id,
      className: el.className,
      hidden: el.hidden,
      textContent: (el.textContent || '').slice(0, 120),
    }));
    const byClassSubstr = Array.from(document.querySelectorAll('[class*="stock"]')).map((el) => ({
      tag: el.tagName,
      id: el.id,
      className: el.className,
      hidden: el.hidden,
      textContent: (el.textContent || '').slice(0, 120),
    }));
    return {
      stockElExists: Boolean(stockEl),
      stockElHidden: stockEl ? stockEl.hidden : null,
      stockElText: stockEl ? stockEl.textContent : null,
      metaOuterHTML: metaEl ? metaEl.outerHTML : null,
      elementsWithStockInId: byIdSubstr,
      elementsWithStockInClass: byClassSubstr,
    };
  });

  await testInfo.attach(`diag-stock--${checkpoint}`, {
    body: JSON.stringify(diag, null, 2),
    contentType: 'application/json',
  });

  return diag;
}

async function selectTargetUnit(page, candidate, testInfo) {
  const addButton = page.locator('#k-add-cart-btn');
  await expect(addButton, 'un produit SKU doit être verrouillé avant résolution complète').toBeDisabled();

  if (testInfo) await captureStockDiagnostics(page, testInfo, '01-before-selection');

  for (const axis of candidate.detail.option_axes) {
    const value = candidate.unit.option_values[axis.key];
    const button = page.locator(optionSelector(axis.key, value));

    await expect(button, `${axis.key}=${value} doit être proposé`).toBeVisible({ timeout: 5_000 });
    await expect(button).toHaveAttribute('data-option-state', 'AVAILABLE');
    await button.click();

    await expect(page.locator(optionSelector(axis.key, value))).toHaveAttribute('aria-pressed', 'true');
  }

  await expect(addButton, 'le CTA doit être actif une fois le SKU réel résolu').toBeEnabled();

  if (testInfo) await captureStockDiagnostics(page, testInfo, '02-after-selection-before-assert');

  await expect(page.locator('#k-modal-stock')).toContainText('Disponible');

  if (candidate.unit.sku) {
    await expect(page.locator('#k-modal-sku')).toContainText(candidate.unit.sku);
  }

  const expectedPrice = candidate.unit.price_kmf ?? candidate.detail.pricing.price_kmf;
  if (expectedPrice != null) {
    await expect.poll(async () => kmfNumber(await page.locator('#k-modal-price').textContent()))
      .toBe(expectedPrice);
  }
}

function assertCanonicalContract(candidate) {
  const { detail, unit } = candidate;
  expect(detail.contract_version).toBe('1');
  expect(detail.inventory_model).toBe('SKU');
  expect(detail.option_axes.length).toBeGreaterThan(0);
  expect(detail.sellable_units.length).toBeGreaterThan(0);

  const mediaIds = new Set((detail.media || []).map((media) => media.id));
  expect((unit.media_ids || []).every((id) => mediaIds.has(id))).toBe(true);

  for (const axis of detail.option_axes) {
    const selectedValue = unit.option_values[axis.key];
    expect(axis.values.some((option) => option.value === selectedValue)).toBe(true);
  }
}

test.describe('E-PDC — Clôture catalogue raffiné + modal enrichie', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!IS_REMOTE, 'Nécessite le vrai backend/catalogue — lancer avec BASE_URL distant');
    test.skip(!PDC_PROJECTS.has(testInfo.project.name), 'Couverture finale bornée aux compositions Chrome mobile + desktop');
  });

  test('E-PDC-1 — le catalogue réel expose un contrat SKU canonique exploitable', async ({ page }) => {
    await page.goto(BASE_URL);
    const candidate = await discoverRealSkuProduct(page);

    expect(
      candidate,
      'le catalogue distant doit exposer au moins un produit SKU disponible avec axes et unité vendable réelle'
    ).not.toBeNull();

    assertCanonicalContract(candidate);
  });

  test('E-PDC-2 — la modal résout un SKU réel et met à jour disponibilité, référence et prix', async ({ page }, testInfo) => {
    await page.goto(BASE_URL);
    const candidate = await discoverRealSkuProduct(page);

    expect(
      candidate,
      'aucun produit SKU canonique disponible trouvé dans les cartes actuellement exposées'
    ).not.toBeNull();

    assertCanonicalContract(candidate);
    await openCandidate(page, candidate, testInfo);
    await selectTargetUnit(page, candidate, testInfo);
  });

  test('E-PDC-3 — la sélection survit au passage mobile → desktop sans second fetch /detail', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'Desktop Chrome', 'Preuve responsive exécutée une seule fois depuis Desktop Chrome');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE_URL);
    const candidate = await discoverRealSkuProduct(page);

    expect(
      candidate,
      'aucun produit SKU canonique disponible trouvé pour la preuve responsive'
    ).not.toBeNull();

    let detailFetchCount = 0;
    const expectedPath = `/api/products/${candidate.productId}/detail`;
    page.on('request', (request) => {
      if (request.url().endsWith(expectedPath)) detailFetchCount += 1;
    });

    await openCandidate(page, candidate);
    await expect(page.locator('[data-pdc4-root="1"]')).toBeVisible();
    await selectTargetUnit(page, candidate);
    expect(detailFetchCount).toBe(1);

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator('[data-pdc5-root="1"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-pdc4-root="1"]')).toHaveCount(0);

    for (const axis of candidate.detail.option_axes) {
      const value = candidate.unit.option_values[axis.key];
      await expect(page.locator(optionSelector(axis.key, value))).toHaveAttribute('aria-pressed', 'true');
    }

    await expect(page.locator('#k-add-cart-btn')).toBeEnabled();
    await expect.poll(() => detailFetchCount).toBe(1);
  });
});
