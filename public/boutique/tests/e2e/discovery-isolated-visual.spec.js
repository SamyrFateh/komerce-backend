/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 *
 * Discovery visual proof: the actual Boutique JS/CSS served locally, with
 * synthetic HTTP fixtures. NEVER contacts Railway or a real provider.
 * This is a browser/component acceptance, NOT staging/prod E2E evidence.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

test.skip(Boolean(process.env.BASE_URL), 'Isolated proof must only run against the local static server.');

const OUT = path.join(__dirname, '../../test-results/discovery-isolated');
const photo = (id) => 'https://images.pexels.com/photos/' + id +
  '/pexels-photo-' + id + '.jpeg?auto=compress&cs=tinysrgb&w=1200';

const FIXTURES = Object.freeze({
  service: {
    kind: 'service',
    id: 'd15c2000-0000-4000-8000-000000000002',
    title: 'Plomberie maison — diagnostic et dépannage',
    subtitle: 'Sur demande',
    provider_name: '[STAGING] Dépannage Anjouan',
    zone: 'Mutsamudu',
    description: 'Diagnostic, fuite, robinetterie et petits travaux de plomberie. Démonstration.',
    image_ref: photo(32588548),
    actions: ['request'],
    whatsapp_available: false,
  },
  offer: {
    kind: 'physical_offer',
    id: 'd15c1000-0000-4000-8000-000000000002',
    title: 'Plateau de samboussas pour réception',
    subtitle: 'Préparation sur commande',
    provider_name: '[STAGING] Saveurs d’Anjouan',
    zone: 'Anjouan',
    description: 'Préparation locale pour réception, sur demande. Démonstration.',
    image_ref: photo(37068875),
    actions: ['request'],
  },
});

const CARD = (fixture, categories) => ({
  kind: fixture.kind,
  title: fixture.title,
  subtitle: fixture.subtitle,
  cta_label: fixture.kind === 'service' ? 'Demander' : 'Commander',
  cta_action_ref: fixture.id,
  image_ref: fixture.image_ref,
  provider_name: fixture.provider_name,
  zone: fixture.zone,
  description: fixture.description,
  category_keys: categories,
});

const PRODUCT = {
  id: 'isolated-demo-product',
  name: 'Produit témoin de navigation',
  description: 'Produit factice strictement local à ce test.',
  image_url: '/boutique/categories/cat-tech-v3.webp',
  price_kmf: 12000,
  category: 'Tech',
  is_active: true,
  is_available: true,
  stock: 10,
  promo_pct: 0,
};

async function installIsolatedApi(page) {
  const writes = [];
  const unexpected = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    if (request.method() !== 'GET') {
      writes.push(request.method() + ' ' + pathname);
      return route.fulfill({ status: 405, contentType: 'application/json',
        body: JSON.stringify({ error: 'isolated_visual_proof_no_mutation' }) });
    }

    let payload = [];
    if (pathname === '/api/products') payload = [PRODUCT];
    else if (pathname === '/api/boutique/suggestions' && url.searchParams.get('surface') === 'local') {
      payload = { cards: [CARD(FIXTURES.service, ['Tech']), CARD(FIXTURES.offer, ['Maison'])] };
    } else if (pathname === '/api/providers-services/services/' + FIXTURES.service.id) {
      payload = FIXTURES.service;
    } else if (pathname === '/api/providers-services/physical-offers/' + FIXTURES.offer.id) {
      payload = FIXTURES.offer;
    } else {
      unexpected.push(pathname);
    }
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(payload) });
  });
  return { writes, unexpected };
}

async function requirePhotoLoaded(locator) {
  await expect(locator).toBeVisible();
  await expect.poll(
    () => locator.evaluate((img) => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0),
    { timeout: 15000, message: 'The actual representative photo must load before visual approval' }
  ).toBe(true);
}

async function proveViewport(page, label, viewport) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.setViewportSize(viewport);
  const audit = await installIsolatedApi(page);
  await page.goto('/boutique/index.html', { waitUntil: 'domcontentloaded' });

  const serviceCard = page.locator('.k-discovery-canonical-card[data-discovery-kind="service"]').first();
  const offerCard = page.locator('.k-discovery-canonical-card[data-discovery-kind="physical_offer"]').first();
  await expect(serviceCard, 'The rail must actually mount in the browser').toBeVisible({ timeout: 15000 });
  await expect(offerCard).toBeVisible();
  await expect(serviceCard).toContainText(FIXTURES.service.title);
  await expect(offerCard).toContainText(FIXTURES.offer.title);
  await requirePhotoLoaded(serviceCard.locator('img'));
  await requirePhotoLoaded(offerCard.locator('img'));
  await page.screenshot({ path: path.join(OUT, label + '-rail.png'), fullPage: false });

  // True user interaction: click a rail card (no direct renderer calls).
  await serviceCard.click();
  const modal = page.locator('#k-modal');
  const detail = page.locator('#k-modal-discovery-detail');
  await expect(detail).toBeVisible({ timeout: 8000 });
  await expect(detail).toHaveAttribute('data-discovery-kind', 'service');
  await expect(detail.locator('.k-service-detail-title')).toHaveText(FIXTURES.service.title);
  await expect(detail).toContainText(FIXTURES.service.provider_name);
  await expect(detail).toContainText(FIXTURES.service.zone);
  await expect(detail).toContainText('Comment ça marche ?');
  await expect(detail.locator('[data-discovery-service-contact]')).toBeVisible();
  await expect(detail.locator('[data-discovery-service-contact]')).toHaveCount(1);
  await requirePhotoLoaded(detail.locator('.k-service-detail-img'));
  await expect(modal.locator('.k-modal-buybox')).toBeHidden();
  await expect(modal.locator('.k-modal-actions')).toBeHidden();
  await expect(modal.locator('#k-buy-now-btn')).toBeHidden();
  await expect(detail).not.toContainText('Acheter maintenant');
  await modal.screenshot({ path: path.join(OUT, label + '-service.png') });

  await page.locator('#k-modal-close').click();
  await expect(page.locator('#k-modal-overlay')).not.toHaveClass(/open/);
  await offerCard.click();
  await expect(detail).toBeVisible({ timeout: 8000 });
  await expect(detail).toHaveAttribute('data-discovery-kind', 'physical_offer');
  await expect(detail).toContainText(FIXTURES.offer.title);
  await expect(detail).toContainText(FIXTURES.offer.zone);
  await requirePhotoLoaded(detail.locator('.k-modal-discovery-img'));
  await expect(detail.locator('[data-discovery-select-action="request"]')).toBeVisible();
  await expect(modal.locator('.k-modal-actions')).toBeHidden();
  await expect(modal.locator('.k-modal-buybox')).toBeHidden();
  await modal.screenshot({ path: path.join(OUT, label + '-offer.png') });

  await page.locator('#k-modal-close').click();
  await expect(page.locator('#k-modal-overlay')).not.toHaveClass(/open/);
  await serviceCard.click();
  await expect(detail.locator('[data-discovery-service-contact]')).toBeVisible();

  // Observe the contact intent. Real identity/Inquiry is intentionally NOT
  // executed: all non-GET API calls are rejected by the local interceptor.
  await page.evaluate(() => {
    window.__discoveryObserved = [];
    window._kbus.on('discovery:request', (payload) => {
      window.__discoveryObserved.push({
        kind: payload.kind, ref: payload.ref, requesterNote: payload.requesterNote,
      });
    });
  });
  await detail.locator('[data-discovery-service-note]').fill('Fuite sous évier');
  await detail.locator('[data-discovery-service-contact]').click();
  await expect.poll(() => page.evaluate(() => window.__discoveryObserved)).toEqual([{
    kind: 'service',
    ref: FIXTURES.service.id,
    requesterNote: 'Fuite sous évier',
  }]);

  expect(audit.writes, 'The demo must never mutate a database or send a real inquiry').toEqual([]);
  console.log('[Discovery isolated] ' + label + ': rail, service, offer and contact intent verified.');
}

test('Discovery desktop: actual rail, service/offer detail and contact intent', async ({ page }) => {
  await proveViewport(page, 'desktop', { width: 1440, height: 900 });
});

test('Discovery mobile: actual rail, service/offer detail and contact intent', async ({ page }) => {
  await proveViewport(page, 'mobile', { width: 390, height: 844 });
});
