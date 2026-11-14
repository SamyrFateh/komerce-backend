/** @test-kind e2e @test-runner playwright @test-requires webapp */
'use strict';

const { test, expect } = require('@playwright/test');
const { IS_REMOTE } = require('./helpers/boutique.helpers');
const { catalogue, stubFixtureCatalogue, openFixtureFromSearch, selectOptions } =
  require('./helpers/modal-v3-fixture-catalogue');

test.skip(IS_REMOTE, 'Tests locaux déterministes — API stubbée.');

const VIEWPORTS = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];

for (const viewport of VIEWPORTS) {
  test(`PDP V4 mini-héro @ ${viewport.width}px : défilement, footer et retour photo`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await stubFixtureCatalogue(page);
    const entry = catalogue.cases.find((item) => item.key === 'stress');
    await openFixtureFromSearch(page, entry);

    const scroll = page.locator('#k-modal .k-modal-scroll');
    const image = page.locator('#k-modal .k-modal-img-wrap');
    const buttons = page.locator('#k-modal > .k-modal-actions');
    await expect(image).toBeVisible();
    await expect(page.locator('.k-modal-topbar-product')).toBeAttached();

    const maxScroll = await scroll.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      return el.scrollTop;
    });
    expect(maxScroll).toBeGreaterThan(0);
    await expect(page.locator('#k-modal')).toHaveClass(/is-scrolled/);

    const mini = page.getByRole('button', { name: 'Revenir aux photos du produit' });
    await expect(mini).toBeVisible();
    await expect(page.locator('.k-topbar-price-val')).toHaveText(await page.locator('#k-modal-price').innerText());

    const geometry = await page.evaluate(() => {
      const modal = document.getElementById('k-modal');
      const actions = modal.querySelector(':scope > .k-modal-actions').getBoundingClientRect();
      const cart = modal.querySelector('.k-modal-cart-btn').getBoundingClientRect();
      const close = modal.querySelector('.k-modal-close').getBoundingClientRect();
      const photo = modal.querySelector('.k-modal-img-wrap');
      return {
        footerVisible: actions.top >= -1 && actions.bottom <= window.innerHeight + 1,
        noCartOverlap: cart.right <= close.left + 1,
        noOverflow: modal.scrollWidth <= modal.clientWidth + 1,
        photoPosition: getComputedStyle(photo).position,
      };
    });
    expect(geometry.footerVisible).toBe(true);
    expect(geometry.noCartOverlap).toBe(true);
    expect(geometry.noOverflow).toBe(true);
    expect(geometry.photoPosition).not.toBe('sticky');
    expect(geometry.photoPosition).not.toBe('fixed');

    await mini.click();
    await expect.poll(() => scroll.evaluate((el) => el.scrollTop), { timeout: 5000 }).toBeLessThan(10);
    await expect(page.locator('#k-modal')).not.toHaveClass(/is-scrolled/);
    await expect(image).toBeVisible();
    await expect(buttons).toBeVisible();
  });
}

test('PDP V4 mini-héro : média et prix recalculés depuis la sélection SKU', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubFixtureCatalogue(page);
  const entry = catalogue.cases.find((item) => item.key === 'elite');
  await openFixtureFromSearch(page, entry);
  await selectOptions(page, entry.validSelection);
  await page.locator('#k-modal .k-modal-scroll').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(page.locator('#k-modal')).toHaveClass(/is-scrolled/);
  const result = await page.evaluate(async () => {
    const { optimizeImgUrl } = await import('/boutique/js/b-utils.js');
    const selected = window._kstate?.modalSelection?.selected_media?.[0]?.url;
    const actual = document.querySelector('.k-topbar-thumb-img')?.getAttribute('src');
    const price = document.querySelector('#k-modal-price')?.textContent;
    const miniPrice = document.querySelector('.k-topbar-price-val')?.textContent;
    return { selected: Boolean(selected), mediaMatch: Boolean(selected && actual === optimizeImgUrl(selected, 120)), priceMatch: price === miniPrice };
  });
  expect(result.selected).toBe(true);
  expect(result.mediaMatch).toBe(true);
  expect(result.priceMatch).toBe(true);
});
