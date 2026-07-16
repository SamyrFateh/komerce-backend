'use strict';

const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'https://komerce.co/boutique/';
const PRODUCT_NAME = 'Eyeshadow Palette with Mirror';
const PRODUCT_ID = '234e5d20-d2b2-4b2b-bfe0-fc34afa420e2';

async function openPaletteModal(page) {
  const failed = [];
  page.on('response', (response) => {
    if (response.status() >= 400 && new URL(response.url()).origin === new URL(BASE_URL).origin) {
      failed.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on('requestfailed', (request) => {
    if (new URL(request.url()).origin === new URL(BASE_URL).origin) {
      failed.push(`REQUESTFAILED ${request.failure()?.errorText || ''} ${request.url()}`);
    }
  });

  const response = await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  expect(response).not.toBeNull();
  expect(response.status()).toBe(200);

  await expect(page.locator('#k-search-input')).toBeVisible({ timeout: 15_000 });
  await page.locator('#k-search-input').fill(PRODUCT_NAME);

  const result = page
    .locator('#k-search-dropdown .k-search-item')
    .filter({ hasText: PRODUCT_NAME })
    .first();
  await expect(result).toBeVisible({ timeout: 15_000 });
  await result.click();

  await expect(page.locator('#k-modal-overlay')).toHaveClass(/open/, { timeout: 10_000 });
  await expect(page.locator('#k-modal-name')).toHaveText(PRODUCT_NAME, { timeout: 10_000 });

  return failed;
}

async function assertPaletteModal(page, testInfo) {
  if (testInfo.project.name === 'Mobile Chrome') {
    // Samsung Internet est basé Chromium ; 360×800 reproduit le viewport compact
    // où les régressions prix/CTA et visualViewport ont été observées.
    await page.setViewportSize({ width: 360, height: 800 });
  }

  const failed = await openPaletteModal(page);

  await expect(page.locator('#k-modal-price')).toContainText('KMF');
  await expect(page.locator('#k-modal-price')).toContainText(/269[\s\u00a0.,]?990/);
  await expect(page.locator('#k-modal-close')).toBeVisible();

  const slides = page.locator('#k-modal-carousel .k-modal-slide');
  await expect(slides).toHaveCount(1);
  await expect(slides.first()).toBeVisible();
  expect(await slides.first().getAttribute('src')).toContain('eyeshadow-palette-with-mirror/1.webp');
  await expect.poll(
    () => slides.first().evaluate((img) => Boolean(img.complete && img.naturalWidth > 0)),
    { timeout: 10_000 }
  ).toBe(true);

  const addButton = page.locator('#k-add-cart-btn');
  await expect(addButton).toBeVisible();
  await expect(addButton).toBeEnabled();
  await expect(page.locator('#k-qty-val')).toHaveText('1');

  const productDataId = await page.locator('#k-modal-overlay').getAttribute('data-product-id').catch(() => null);
  if (productDataId) expect(productDataId).toBe(PRODUCT_ID);

  const layout = await page.evaluate(() => {
    const overlay = document.getElementById('k-modal-overlay');
    const modal = document.getElementById('k-modal');
    const price = document.getElementById('k-modal-price');
    const cta = document.getElementById('k-add-cart-btn');
    const modalRect = modal?.getBoundingClientRect();
    const priceRect = price?.getBoundingClientRect();
    const ctaRect = cta?.getBoundingClientRect();
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      overlayOpen: overlay?.classList.contains('open') || false,
      modal: modalRect ? { top: modalRect.top, bottom: modalRect.bottom, left: modalRect.left, right: modalRect.right } : null,
      priceVisible: priceRect ? priceRect.top < window.innerHeight && priceRect.bottom > 0 : false,
      ctaVisible: ctaRect ? ctaRect.top < window.innerHeight && ctaRect.bottom > 0 : false,
    };
  });

  expect(layout.overlayOpen).toBe(true);
  expect(layout.horizontalOverflow).toBeLessThanOrEqual(2);
  expect(layout.modal).not.toBeNull();
  expect(layout.modal.left).toBeGreaterThanOrEqual(-2);
  expect(layout.modal.right).toBeLessThanOrEqual(layout.viewport.width + 2);
  expect(layout.priceVisible).toBe(true);

  if (testInfo.project.name === 'Mobile Chrome') {
    expect(layout.viewport).toEqual({ width: 360, height: 800 });
    expect(layout.ctaVisible).toBe(true);
  }

  expect(failed, `Ressources/API locales en échec: ${failed.join('\n')}`).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath(`ing6-palette-modal-${testInfo.project.name.replace(/\s+/g, '-').toLowerCase()}.png`),
    fullPage: false,
  });
}

test.describe('ING-6 — Palette publiée dans la modale réelle', () => {
  test('nom, prix, galerie unique, stock et CTA', async ({ page }, testInfo) => {
    await assertPaletteModal(page, testInfo);
  });
});
