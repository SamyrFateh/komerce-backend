/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */
'use strict';

// Preuve Chromium non mutante : vraie coque Boutique/CSS, catalogue de recette
// intercepté uniquement pour construire 4 lignes de panier déterministes.
// Aucun paiement, aucun POST de commande ni écriture DB.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { buildEnrichedFixture } = require('./helpers/geometry-fixtures');

const OUT = path.join(process.cwd(), 'test-results', 'pdp-sidecart-geometry');
const SIZES = [1440, 1700, 1920];
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000/boutique/';

function fixtureProduct(detail) {
  return {
    id: detail.product.id,
    name: detail.product.name,
    price_kmf: detail.pricing.price_kmf,
    description: detail.product.description || '',
    images: (detail.media || []).map(media => media.url),
    image_url: (detail.media || [])[0]?.url || '',
    category: detail.product.category || 'mode',
    is_available: true, stock: 12,
    inventory_model: detail.inventory_model,
  };
}

async function openWithFourCartLines(page) {
  const detail = buildEnrichedFixture();
  // Le rail unique est volontairement sans supplément visible.
  detail.delivery_options = [{
    code: 'SEA_STANDARD', label: 'Livraison standard',
    available: true, price_kmf: null, eta_label: null, unavailable_reason: null,
  }];
  const product = fixtureProduct(detail);
  // Staging utilise les API de bootstrap réelles. Le fallback [] est
  // réservé au serveur local statique sans backend.
  if (!process.env.BASE_URL) {
    await page.route(/\/api\//, route => route.fulfill({
      status: 200, contentType: 'application/json', body: '[]',
    }));
  }
  await page.route(/\/api\/boutique\/suggestions/, route => route.fulfill({
    status: 200, contentType: 'application/json', body: '{"suggestions":[]}',
  }));
  await page.route(/\/api\/products(\?|$)/, route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify([product]),
  }));
  await page.route(/\/api\/products\/[^/]+\/detail/, route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify(detail),
  }));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  // Ne pas dépendre des globals debug, absents volontairement en staging.
  // Playwright importe les modules canoniques dans l'origine de la page :
  // aucun instrument de debug n'est ajouté au runtime public.
  await page.waitForSelector('#k-modal-overlay', { state: 'attached', timeout: 12000 });
  await page.evaluate(async product => {
    const [{ state }, { bus }] = await Promise.all([
      import('/boutique/js/b-store.js'),
      import('/boutique/js/b-bus.js'),
    ]);
    if (!state || !bus) throw new Error('Modules Boutique non disponibles');
    const items = [
      { variant: 'Red / 3XL', qty: 2 },
      { variant: 'Red / XL', qty: 1 },
      { variant: 'Black / L', qty: 1 },
      { variant: 'Black / 4XL', qty: 1 },
    ];
    state.cart = items.map((item, i) => ({
      product: {
        id: 'pdp-proof-' + i,
        name: 'Chemise femme à imprimé multicolore',
        price_kmf: 8990,
        image_url: product.image_url,
      },
      qty: item.qty,
      variant_label: item.variant,
    }));
    bus.emit('side-cart:render');
    if (!state.products.some(p => String(p.id) === String(product.id))) state.products.push(product);
    bus.emit('modal:open', { id: product.id });
  }, product);
  await expect(page.locator('#k-modal')).toBeVisible({ timeout: 12000 });
  await expect(page.locator('#k-modal .k-modal-cart-slot #k-side-cart')).toBeVisible({ timeout: 12000 });
  await expect(page.locator('#k-modal .k-sc-item')).toHaveCount(4, { timeout: 7000 });
  await page.waitForTimeout(350);
}

function bounds(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
}

for (const width of SIZES) {
  test('PDP side cart / galerie / buybox à ' + width + 'px', async ({ page }) => {
    test.setTimeout(35000);
    await page.setViewportSize({ width, height: 900 });
    await openWithFourCartLines(page);
    const evidence = await page.evaluate(() => {
      const q = selector => document.querySelector(selector);
      const box = el => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, width: r.width, right: r.right, y: r.y, height: r.height };
      };
      const body = box(q('#k-modal .k-modal-body'));
      const gallery = box(q('#k-modal .k-modal-product-zone .k-modal-img-wrap'));
      const buybox = box(q('#k-modal .k-modal-product-zone > .k-modal-right-rail'));
      const side = box(q('#k-modal .k-modal-cart-slot'));
      const cart = box(q('#k-modal .k-modal-cart-slot #k-side-cart'));
      const lines = [...document.querySelectorAll('#k-modal .k-sc-item')].map(box);
      const controls = [...document.querySelectorAll('#k-modal .k-sc-item-actions, #k-modal .k-sc-subtotal-amount, #k-modal #k-sc-checkout')].map(box);
      const overflow = controls.filter(c => c && side && (c.right > side.right - 5 || c.x < side.x - 2));
      return {
        viewport: innerWidth,
        body, gallery, buybox, side, cart, lines, controls,
        overflowCount: overflow.length,
        overflow,
        documentOverflowX: document.documentElement.scrollWidth - innerWidth,
        transportText: q('#k-modal-delivery')?.textContent?.trim() || '',
      };
    });
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'measure-' + width + '.json'), JSON.stringify(evidence, null, 2));
    await page.screenshot({
      path: path.join(OUT, 'pdp-' + width + '.png'), animations: 'disabled',
    });
    expect(evidence.body).not.toBeNull();
    expect(evidence.side).not.toBeNull();
    expect(evidence.cart).not.toBeNull();
    expect(evidence.cart.width).toBeGreaterThanOrEqual(evidence.side.width - 2);
    expect(evidence.cart.right).toBeLessThanOrEqual(evidence.side.right + 2);
    expect(evidence.gallery).not.toBeNull();
    expect(evidence.buybox).not.toBeNull();
    console.log('PDP_GEOMETRY_EVIDENCE', JSON.stringify(evidence));
    expect(evidence.side.width).toBeGreaterThanOrEqual(width === 1440 ? 310 : width === 1700 ? 365 : 385);
    expect(evidence.overflowCount, JSON.stringify(evidence.overflow)).toBe(0);
    expect(evidence.documentOverflowX).toBeLessThanOrEqual(2);
    const ratio = {
      gallery: evidence.gallery.width / evidence.body.width,
      buybox: evidence.buybox.width / evidence.body.width,
      side: evidence.side.width / evidence.body.width,
    };
    expect(ratio.gallery).toBeGreaterThan(.40);
    expect(ratio.gallery).toBeLessThan(.49);
    expect(ratio.buybox).toBeGreaterThan(.28);
    expect(ratio.buybox).toBeLessThan(.39);
    expect(ratio.side).toBeGreaterThan(.18);
    expect(ratio.side).toBeLessThan(.26);
    expect(evidence.transportText).not.toContain('26 KMF');
    // Géométrie et ordre du mock validé, dans le VRAI navigateur Chromium.
    const composition = await page.evaluate(async () => {
      const { state } = await import('/boutique/js/b-store.js');
      const q = selector => document.querySelector(selector);
      const gallery = q('#k-modal .k-modal-img-wrap').getBoundingClientRect();
      const buybox = q('#k-modal .k-modal-right-rail').getBoundingClientRect();
      return {
        mediaShare: gallery.width / (gallery.width + buybox.width),
        description: q('#k-modal-long-description').textContent.trim(),
        descriptionHidden: q('#k-modal-long-description').hidden,
        rowDescription: getComputedStyle(q('#k-modal-long-details')).gridRowStart,
        rowDetails: getComputedStyle(q('#k-modal-enriched-content')).gridRowStart,
        rowRecommendations: getComputedStyle(q('#k-modal-suggestions')).gridRowStart,
        selectedOptions: state.modalSelection?.selected_options || {},
      };
    });
    expect(composition.mediaShare).toBeGreaterThan(.53);
    expect(composition.mediaShare).toBeLessThan(.57);
    expect(evidence.side.width).toBeGreaterThanOrEqual(320);
    expect(evidence.side.width).toBeLessThanOrEqual(361);
    expect(composition.description).toContain('Chaussure de football haute performance');
    expect(composition.descriptionHidden).toBe(false);
    expect(composition.rowDescription).toBe('2');
    expect(composition.rowDetails).toBe('3');
    expect(composition.rowRecommendations).toBe('4');
    expect(Object.keys(composition.selectedOptions)).toHaveLength(0);
    await page.evaluate(() => {
      const main = document.querySelector('#k-modal .k-modal-main');
      main.scrollTop = main.scrollHeight;
    });
    await page.screenshot({
      path: path.join(OUT, 'pdp-below-hero-' + width + '.png'),
      animations: 'disabled',
    });
  });
}

test('marché KM — devis maritime interne non exposé sur le détail public réel', async ({ request }) => {
  test.skip(!process.env.BASE_URL, 'Contrôle du serveur réel réservé à la campagne staging');
  const root = new URL(BASE);
  const catalog = await request.get(new URL('/api/products?market=KM&limit=1000', root).toString());
  expect(catalog.ok()).toBeTruthy();
  const body = await catalog.json();
  const product = (body.products || body.items || (Array.isArray(body) ? body : []))
    .find(x => x.product_ref === 'KPR-000101');
  expect(product, 'Le produit de la capture doit être exposé en staging KM').toBeDefined();
  const response = await request.get(new URL('/api/products/' + product.id + '/detail?market=KM', root).toString());
  expect(response.ok()).toBeTruthy();
  const detail = await response.json();
  const sea = (detail.delivery_options || []).find(x => x.code === 'SEA_STANDARD');
  expect(sea).toBeDefined();
  expect(sea.price_kmf).toBeNull();
});
