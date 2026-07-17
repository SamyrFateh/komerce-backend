/**
 * @e2e   product-detail-pdc.spec.js
 * @feature catalog, modal-product
 * @brief Clôture PDC-8 : contrat détail canonique → sélection SKU → parité responsive
 *
 * ── HISTORIQUE ────────────────────────────────────────────────────────────
 * La version précédente balayait les cartes de la grille pour trouver un
 * produit SKU. La grille mélange les produits côté client (Fisher-Yates dans
 * _balancedPick) et limite le desktop à ~96 cartes sur ~969. Le Golden
 * Product n'apparaissait que ~1 fois sur 10 : les tests étaient rouges
 * 9 exécutions sur 10.
 *
 * Cette version :
 *   E-PDC-1 : découvre le Golden via l'API (déterministe)
 *   E-PDC-2 : l'ouvre par la recherche (vrai geste utilisateur)
 *   E-PDC-3 : vérifie la parité responsive mobile → desktop
 *
 * Abstractions conservées : targetAvailableUnit(), assertCanonicalContract(),
 * selectTargetUnit(). Seule la découverte change.
 *
 * ── PRÉREQUIS ─────────────────────────────────────────────────────────────
 * Golden Product seedé :  node scripts/seed-golden-product.js
 * Précondition absente = FAIL, jamais skip.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const {
  BASE_URL,
  waitForModalOpen,
  IS_REMOTE,
} = require('./helpers/boutique.helpers');

const golden = require('../../../../tests/fixtures/catalog/golden-elite-pro');

const GOLDEN_ID = golden.PRODUCT_ID;
const PDC_PROJECTS = new Set(['Desktop Chrome', 'Mobile Chrome']);

function optionSelector(axisKey, optionValue) {
  const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `[data-axis-key="${esc(axisKey)}"] button[data-option-value="${esc(optionValue)}"]`;
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

function assertCanonicalContract(candidate) {
  const { detail, unit } = candidate;
  expect(detail.contract_version).toBe('1');
  expect(detail.inventory_model).toBe('SKU');
  expect(detail.option_axes.length).toBeGreaterThan(0);
  expect(detail.sellable_units.length).toBeGreaterThan(0);
  const mediaIds = new Set((detail.media || []).map((m) => m.id));
  expect((unit.media_ids || []).every((id) => mediaIds.has(id))).toBe(true);
  for (const axis of detail.option_axes) {
    const selectedValue = unit.option_values[axis.key];
    expect(axis.values.some((option) => option.value === selectedValue)).toBe(true);
  }
}

async function selectTargetUnit(page, candidate) {
  const addButton = page.locator('#k-add-cart-btn');
  await expect(addButton, 'SKU non résolu — CTA doit être désactivé avant sélection').toBeDisabled();
  for (const axis of candidate.detail.option_axes) {
    const value = candidate.unit.option_values[axis.key];
    const button = page.locator(optionSelector(axis.key, value));
    await expect(button, `${axis.key}=${value} doit être proposé`).toBeVisible({ timeout: 5_000 });
    await expect(button).toHaveAttribute('data-option-state', 'AVAILABLE');
    // L'overlay modal (#k-modal-overlay) recouvre le viewport par conception.
    // Ni click() ni click({force:true}) ne délivrent l'event au handler JS
    // de la modale — l'overlay le capture. On dispatch directement sur
    // l'élément, même motif que boutique.helpers.js (« l'overlay intercepte
    // le clic Playwright »).
    await button.dispatchEvent('click');
    await expect(page.locator(optionSelector(axis.key, value))).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(addButton, 'CTA doit être actif une fois le SKU résolu').toBeEnabled();
  // Affordance de disponibilité : deux DOM distincts par design (PDC4 mobile
  // vs PDC5 desktop, cf. docs/BOUTIQUE_MODAL_ARCHITECTURE.md). Le desktop
  // écrit dans #k-modal-stock (b-modal-desktop-product.js::renderStock).
  // Le mobile écrit dans un chip .k-mdm-chip--ok du info-strip
  // (b-modal-mobile-product.js::renderInfoStrip) et ne touche jamais
  // #k-modal-stock. Pas un bug — parité de contenu, pas de DOM.
  const viewport = page.viewportSize();
  const isMobile = viewport ? viewport.width < 900 : false;
  const availabilityLocator = isMobile
    ? page.locator('[data-info-strip] .k-mdm-chip--ok')
    : page.locator('#k-modal-stock');
  await expect(availabilityLocator).toContainText('Disponible');
  if (candidate.unit.sku) {
    await expect(page.locator('#k-modal-sku')).toContainText(candidate.unit.sku);
  }
  const expectedPrice = candidate.unit.price_kmf ?? candidate.detail.pricing.price_kmf;
  if (expectedPrice != null) {
    await expect.poll(async () => kmfNumber(await page.locator('#k-modal-price').textContent()))
      .toBe(expectedPrice);
  }
}

// ── Découverte par l'API (déterministe, indépendant du shuffle) ──────────

async function discoverGoldenProduct(request) {
  const baseApiUrl = BASE_URL.replace(/\/boutique\/?$/, '');
  const url = `${baseApiUrl}/api/products/${GOLDEN_ID}/detail`;
  const response = await request.get(url);
  expect(
    response.status(),
    `Golden Product introuvable (${url}) — seed-golden-product.js non exécuté ?`
  ).toBe(200);
  const detail = await response.json();
  const unit = targetAvailableUnit(detail);
  expect(
    unit,
    'Golden Product présent mais aucune unité vendable — stock à 0 ou contrat incomplet'
  ).not.toBeNull();
  return { productId: GOLDEN_ID, detail, unit };
}

// ── Ouverture par la recherche (vrai geste utilisateur) ──────────────────

async function openGoldenViaSearch(page) {
  const QUERY = 'Elite Pro';
  // Attendre que la grille ait chargé — state.products doit être peuplé
  // AVANT de chercher, sinon le filtre retourne 0 et le dropdown ne s'ouvre pas.
  await page.waitForSelector('#k-grid .k-card, #k-grid .k-promo-card', {
    state: 'attached', timeout: 15_000,
  });
  const input = page.locator('#k-search-input');
  await expect(input).toBeVisible({ timeout: 5_000 });
  // type() déclenche les events input/keydown caractère par caractère,
  // ce qui active le debounce de setupSearch(). fill() peut ne pas
  // déclencher l'event 'input' dans certains contextes Playwright.
  await input.clear();
  await input.type(QUERY, { delay: 30 });
  const searchItem = page.locator(`.k-search-item[data-id="${GOLDEN_ID}"]`);
  await expect(
    searchItem,
    `recherche "${QUERY}" ne rend pas le Golden dans le dropdown`
  ).toBeVisible({ timeout: 6_000 });
  await searchItem.click();

  // Le handler JS ferme le dropdown et vide l'input (b-catalog.js:748-749).
  // Attendre que le dropdown ne soit plus ouvert AVANT d'interagir avec la modale —
  // sinon il intercepte les clics sur les boutons de variante.
  await expect(page.locator('#k-search-dropdown')).not.toHaveClass(/open/, { timeout: 4_000 });

  await waitForModalOpen(page);
  const viewport = page.viewportSize();
  const isMobile = viewport ? viewport.width < 900 : false;
  const root = isMobile ? '[data-pdc4-root="1"]' : '[data-pdc5-root="1"]';
  await expect(page.locator(root)).toBeVisible({ timeout: 8_000 });
}

// ── TESTS ────────────────────────────────────────────────────────────────

test.describe('E-PDC — Clôture catalogue raffiné + modal enrichie', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(!IS_REMOTE, 'Nécessite le vrai backend/catalogue');
    test.skip(!PDC_PROJECTS.has(testInfo.project.name), 'Chrome mobile + desktop uniquement');
  });

  test('E-PDC-1 — le Golden Product expose un contrat SKU canonique exploitable', async ({ request }) => {
    const candidate = await discoverGoldenProduct(request);
    assertCanonicalContract(candidate);
  });

  test('E-PDC-2 — la modal résout un SKU réel et met à jour disponibilité, référence et prix', async ({ page, request }) => {
    await page.goto(BASE_URL);
    const candidate = await discoverGoldenProduct(request);
    assertCanonicalContract(candidate);
    await openGoldenViaSearch(page);
    await selectTargetUnit(page, candidate);
  });

  test('E-PDC-3 — la sélection survit au passage mobile → desktop sans second fetch /detail', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'Desktop Chrome', 'Preuve responsive depuis Desktop Chrome uniquement');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE_URL);
    const candidate = await discoverGoldenProduct(request);

    let detailFetchCount = 0;
    const expectedPath = `/api/products/${candidate.productId}/detail`;
    page.on('request', (req) => {
      if (req.url().includes(expectedPath)) detailFetchCount += 1;
    });

    await openGoldenViaSearch(page);
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
