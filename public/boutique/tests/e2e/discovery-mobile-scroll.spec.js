/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

'use strict';

const { test, expect } = require('@playwright/test');

function product(index) {
  return {
    id: `scroll-product-${index}`,
    name: `Produit scroll ${index}`,
    description: 'Produit de contrôle du pager mobile',
    price_kmf: 1000 + index,
    image_url: '',
    images: [],
    category: index % 2 ? 'Mode' : 'Maison',
    is_available: true,
    stock: 10,
    inventory_model: 'SIMPLE',
  };
}

function discoveryCard(kind, index) {
  return {
    kind,
    title: `Discovery ${index}`,
    subtitle: kind === 'service' ? 'Sur demande' : 'Disponible maintenant',
    cta_label: kind === 'service' ? 'Demander' : 'Acheter',
    cta_action_ref: `discovery-${index}`,
    price: kind === 'product' ? 42000 + index : null,
    provider_name: kind === 'service' ? 'Prestataire local' : null,
    zone: kind === 'service' ? 'Anjouan' : null,
  };
}

test('Discovery 2×2 reste dans le scroll owner vertical du pager Temu mobile', async ({ page }) => {
  test.skip((page.viewportSize()?.width || 0) >= 900, 'Contrat mobile uniquement');

  const products = Array.from({ length: 16 }, (_, index) => product(index + 1));
  const discovery = [
    discoveryCard('product', 1),
    discoveryCard('service', 2),
    discoveryCard('product', 3),
    discoveryCard('service', 4),
  ];

  // Routes résolues en LIFO : fallback d'abord, contrats précis ensuite.
  await page.route(/\/api\//, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '{}',
  }));
  await page.route(/\/api\/products(?:\?|$)/, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(products),
  }));
  await page.route(/\/api\/boutique\/suggestions/, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ cards: discovery }),
  }));

  await page.goto('/boutique/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#k-grid.k-grid-cat-pager > .k-cat-section[data-cat="all"]:not([data-ghost]) #k-discovery-local', {
    timeout: 8_000,
  });
  await expect(page.locator('#k-discovery-local .k-discovery-card')).toHaveCount(4);

  const geometry = await page.locator('#k-grid > .k-cat-section[data-cat="all"]:not([data-ghost])').evaluate(pageEl => ({
    overflowY: getComputedStyle(pageEl).overflowY,
    clientHeight: pageEl.clientHeight,
    scrollHeight: pageEl.scrollHeight,
    discoveryIsFirst: pageEl.firstElementChild?.id === 'k-discovery-local',
    discoveryCount: pageEl.querySelectorAll(':scope > #k-discovery-local').length,
  }));

  expect(geometry.discoveryIsFirst).toBe(true);
  expect(geometry.discoveryCount).toBe(1);
  expect(geometry.overflowY).toBe('auto');
  expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight + 200);

  const scroller = page.locator('#k-grid > .k-cat-section[data-cat="all"]:not([data-ghost])');
  await scroller.evaluate(pageEl => pageEl.scrollTo({ top: 320, behavior: 'instant' }));
  await expect.poll(() => scroller.evaluate(pageEl => pageEl.scrollTop)).toBeGreaterThan(200);

  await expect(page.locator('[data-ghost] #k-discovery-local')).toHaveCount(0);
  await expect(page.locator('#k-grid #k-discovery-local')).toHaveCount(1);
});
