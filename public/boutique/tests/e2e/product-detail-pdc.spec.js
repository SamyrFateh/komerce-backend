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

const PDC_PROJECTS = new Set(['Desktop Chrome', 'Mobile Chrome']);

// Taille de page pour GET /api/products?limit=&offset= (catalogue complet,
// tri stable côté serveur — indépendant du rendu client).
const PRODUCTS_LIST_PAGE_SIZE = 200;
// Concurrence des fetch /detail au sein d'une page de découverte.
const SKU_DISCOVERY_BATCH_SIZE = 12;

function escapeAttr(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function searchItemSelector(productId) {
  return `#k-search-dropdown .k-search-item[data-id="${escapeAttr(productId)}"]`;
}

function optionSelector(axisKey, optionValue) {
  return `[data-axis-key="${escapeAttr(axisKey)}"] button[data-option-value="${escapeAttr(optionValue)}"]`;
}

function kmfNumber(text) {
  const digits = String(text || '').replace(/[^0-9]/g, '');
  return digits ? Number(digits) : null;
}

function isMobileComposition(page) {
  const viewport = page.viewportSize();
  return viewport ? viewport.width < 900 : false;
}

function stockLocator(page) {
  return page.locator(isMobileComposition(page) ? '#k-modal-stock-pill' : '#k-modal-stock');
}

async function assertResolvedStock(page, unit) {
  const stock = stockLocator(page);
  await expect(stock, 'la disponibilité du SKU résolu doit être rendue dans la composition active').toBeVisible();
  const qty = Number(unit.available_quantity);
  if (qty <= 5) {
    await expect(stock).toContainText(`Plus que ${qty}`);
  } else if (isMobileComposition(page)) {
    await expect(stock).toContainText('En stock');
  } else {
    await expect(stock).toContainText(`${qty} en stock`);
  }
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

/** Une page de GET /api/products — source stable, non échantillonnée. */
async function fetchProductsPage(page, offset, limit) {
  return page.evaluate(async ({ offset, limit }) => {
    try {
      const response = await fetch(`/api/products?limit=${limit}&offset=${offset}`, {
        credentials: 'include',
      });
      if (!response.ok) return { products: [], total: 0 };
      const data = await response.json();
      return { products: Array.isArray(data.products) ? data.products : [], total: Number(data.total) || 0 };
    } catch (_) {
      return { products: [], total: 0 };
    }
  }, { offset, limit });
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

/**
 * Découvre un produit SKU réel + unité vendable AVAILABLE en interrogeant
 * directement /api/products (catalogue entier, paginé, tri serveur stable).
 *
 * IMPORTANT : on ne scanne plus les cartes de #k-grid. b-catalog.js::_balancedPick
 * tire un échantillon ALÉATOIRE (Math.random(), non seedé) du catalogue à
 * chaque chargement de page pour l'affichage — scanner le DOM rendait la
 * découverte non-déterministe (un candidat valide pouvait être absent du
 * tirage d'un run à l'autre sans qu'aucun code métier n'ait changé).
 * /api/products, lui, est une source stable et exhaustive.
 */
async function discoverRealSkuProduct(page) {
  await waitForGrid(page); // attend que l'app ait fini de charger le catalogue

  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const { products: pageProducts, total: pageTotal } = await fetchProductsPage(page, offset, PRODUCTS_LIST_PAGE_SIZE);
    total = pageTotal || 0;
    if (!pageProducts.length) break;

    for (let i = 0; i < pageProducts.length; i += SKU_DISCOVERY_BATCH_SIZE) {
      const batch = pageProducts.slice(i, i + SKU_DISCOVERY_BATCH_SIZE);
      const results = await fetchProductDetails(page, batch.map((p) => p.id));

      for (const { productId, detail } of results) {
        const unit = targetAvailableUnit(detail);
        if (unit) {
          const listEntry = batch.find((p) => p.id === productId);
          return { productId, name: listEntry ? listEntry.name : null, detail, unit };
        }
      }
    }

    offset += pageProducts.length;
  }

  return null;
}

/**
 * Ouvre la modale via la recherche plutôt que via un clic sur une carte de
 * grille : #k-search-input filtre sur state.products (catalogue COMPLET en
 * mémoire, pas l'échantillon rendu), et .k-search-item porte déjà data-id.
 * Déterministe quel que soit le tirage aléatoire de la grille.
 */
async function openCandidate(page, candidate) {
  const input = page.locator('#k-search-input');
  await expect(input, 'le champ de recherche doit être visible').toBeVisible({ timeout: 5_000 });

  const term = (candidate.name || candidate.productId).trim();
  await input.fill(term.length >= 2 ? term : candidate.productId);

  const dropdown = page.locator('#k-search-dropdown');
  await expect(dropdown, 'le dropdown de recherche doit s\'ouvrir').toHaveClass(/open/, { timeout: 5_000 });

  const item = page.locator(searchItemSelector(candidate.productId));
  await expect(item, `résultat de recherche pour ${candidate.productId} (terme: "${term}")`).toBeVisible({ timeout: 5_000 });
  await item.click();

  await waitForModalOpen(page);

  const viewport = page.viewportSize();
  const isMobile = viewport ? viewport.width < 900 : false;
  const root = isMobile ? '[data-pdc4-root="1"]' : '[data-pdc5-root="1"]';
  await expect(page.locator(root)).toBeVisible({ timeout: 8_000 });
}

async function selectTargetUnit(page, candidate) {
  const addButton = page.locator('#k-add-cart-btn');
  await expect(addButton, 'un produit SKU doit être verrouillé avant résolution complète').toBeDisabled();

  for (const axis of candidate.detail.option_axes) {
    const value = candidate.unit.option_values[axis.key];
    const button = page.locator('#k-modal-configurator').locator(optionSelector(axis.key, value));

    await expect(button, `${axis.key}=${value} doit être proposé`).toBeVisible({ timeout: 5_000 });
    await expect(button).toHaveAttribute('data-option-state', 'AVAILABLE');
    await button.click();

    await expect(page.locator(optionSelector(axis.key, value))).toHaveAttribute('aria-pressed', 'true');
  }

  await expect(addButton, 'le CTA doit être actif une fois le SKU réel résolu').toBeEnabled();
  await assertResolvedStock(page, candidate.unit);

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

  test('E-PDC-2 — la modal résout un SKU réel et met à jour disponibilité, référence et prix', async ({ page }) => {
    await page.goto(BASE_URL);
    const candidate = await discoverRealSkuProduct(page);

    expect(
      candidate,
      'aucun produit SKU canonique disponible trouvé dans le catalogue distant'
    ).not.toBeNull();

    assertCanonicalContract(candidate);
    await openCandidate(page, candidate);
    await selectTargetUnit(page, candidate);
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
