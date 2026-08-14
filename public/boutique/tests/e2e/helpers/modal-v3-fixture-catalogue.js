'use strict';

const { expect } = require('@playwright/test');
const catalogue = require('../../fixtures/modal-v3-enriched-catalogue.js');

async function stubFixtureCatalogue(page) {
  // Playwright résout les routes dans l'ordre inverse d'enregistrement :
  // le fallback générique est donc posé en premier, puis les routes précises.
  await page.route(/\/api\//, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '[]',
  }));

  await page.route(/\/api\/boutique\/suggestions/, (route) => {
    const currentId = new URL(route.request().url()).searchParams.get('product_id');
    const suggestions = catalogue.products.filter((product) => String(product.id) !== String(currentId)).slice(0, 4);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ suggestions }),
    });
  });

  await page.route(/\/api\/products\/[^/?]+\/detail/, (route) => {
    const url = new URL(route.request().url());
    const parts = url.pathname.split('/').filter(Boolean);
    const detailIndex = parts.lastIndexOf('detail');
    const id = decodeURIComponent(parts[detailIndex - 1] || '');
    const entry = catalogue.getCaseById(id);
    if (!entry) {
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'fixture_not_found', id }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(entry.detail) });
  });

  await page.route(/\/api\/products(?:\?|$)/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(catalogue.products),
  }));
}

async function openFixtureFromSearch(page, entry) {
  await page.goto('/boutique/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window._kbus && window._kstate, null, { timeout: 8_000 });

  const input = page.locator('#k-search-input');
  const dropdown = page.locator('#k-search-dropdown');
  await input.fill(entry.search);
  await expect(dropdown).toHaveClass(/open/, { timeout: 5_000 });

  const result = dropdown.locator('.k-search-item').filter({ hasText: entry.detail.product.name }).first();
  await expect(result, `résultat de recherche absent pour ${entry.detail.product.reference}`).toBeVisible({ timeout: 5_000 });
  await result.click();

  await expect(page.locator('#k-modal-overlay')).toHaveClass(/open/, { timeout: 6_000 });
  await expect(page.locator('#k-modal-name')).toHaveText(entry.detail.product.name, { timeout: 5_000 });
}

async function selectOptions(page, selection) {
  for (const [axisKey, value] of Object.entries(selection || {})) {
    const option = page.locator(`[data-axis-key="${axisKey}"] button[data-option-value="${value}"]`);
    await expect(option, `${axisKey}=${value} introuvable`).toBeVisible({ timeout: 4_000 });
    await option.click();
  }
}

async function expectCanonicalOrder(page) {
  const order = await page.evaluate(() => {
    const scroll = document.querySelector('.k-modal-scroll');
    const zone = document.querySelector('.k-modal-product-zone');
    const conf = document.getElementById('k-modal-configurator');
    const details = document.getElementById('k-modal-long-details');
    const enriched = document.getElementById('k-modal-enriched-content');
    const suggestions = document.getElementById('k-modal-suggestions');
    const desktop = window.innerWidth >= 900;

    const isBefore = (first, second) => Boolean(
      first &&
      second &&
      (first.compareDocumentPosition(second) &
        Node.DOCUMENT_POSITION_FOLLOWING)
    );

    return {
      desktop,

      exists: {
        scroll: Boolean(scroll),
        zone: Boolean(zone),
        conf: Boolean(conf),
        details: Boolean(details),
        enriched: Boolean(enriched),
        suggestions: Boolean(suggestions),
      },

      insideProductScroll: {
        zone: Boolean(scroll && zone && scroll.contains(zone)),
        conf: Boolean(scroll && conf && scroll.contains(conf)),
        details: Boolean(scroll && details && scroll.contains(details)),
        enriched: Boolean(scroll && enriched && scroll.contains(enriched)),
        suggestions: Boolean(scroll && suggestions && scroll.contains(suggestions)),
      },

      sequence: {
        confBeforeSuggestions: isBefore(conf, suggestions),

        desktopSuggestionsBeforeDetails:
          !desktop || isBefore(suggestions, details),

        desktopDetailsBeforeEnriched:
          !desktop || isBefore(details, enriched),

        mobileDetailsBeforeEnriched:
          desktop || isBefore(details, enriched),

        mobileEnrichedBeforeSuggestions:
          desktop || isBefore(enriched, suggestions),
      },
    };
  });

  expect(order.exists).toEqual({
    scroll: true,
    zone: true,
    conf: true,
    details: true,
    enriched: true,
    suggestions: true,
  });

  expect(order.insideProductScroll).toEqual({
    zone: true,
    conf: true,
    details: true,
    enriched: true,
    suggestions: true,
  });

  expect(order.sequence).toEqual({
    confBeforeSuggestions: true,
    desktopSuggestionsBeforeDetails: true,
    desktopDetailsBeforeEnriched: true,
    mobileDetailsBeforeEnriched: true,
    mobileEnrichedBeforeSuggestions: true,
  });
}

module.exports = {
  catalogue,
  stubFixtureCatalogue,
  openFixtureFromSearch,
  selectOptions,
  expectCanonicalOrder,
};
