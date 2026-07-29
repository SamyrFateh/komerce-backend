'use strict';

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const {
  IS_REMOTE,
  addToCartFromModal,
  assertNoOverlayOnActions,
} = require('./helpers/boutique.helpers');

const {
  catalogue,
  stubFixtureCatalogue,
  openFixtureFromSearch,
  selectOptions,
  expectCanonicalOrder,
} = require('./helpers/modal-v3-fixture-catalogue');

test.skip(
  IS_REMOTE,
  'Clôture responsive Modal V3 : oracle local déterministe uniquement.'
);

const SHOT_DIR = path.resolve(
  __dirname,
  '../../docs/_work/modal-v3-desktop-responsive'
);

const VIEWPORTS = [
  { key: '900x800', width: 900, height: 800 },
  { key: '1024x768', width: 1024, height: 768 },
  { key: '1366x768', width: 1366, height: 768 },
  { key: '1440x900', width: 1440, height: 900 },
];

async function capture(page, fileName) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  await page.locator('#k-modal').screenshot({
    path: path.join(SHOT_DIR, fileName),
    animations: 'disabled',
  });
}

async function measureDesktop(page) {
  return page.evaluate(() => {
    const px = (value) => Number.parseFloat(value) || 0;

    const modal = document.getElementById('k-modal');
    const zone = document.querySelector('.k-modal-product-zone');
    const configurator =
      document.getElementById('k-modal-configurator');
    const media = document.querySelector('.k-modal-img-wrap');
    const narrative = document.querySelector('.k-modal-details');

    if (
      !modal ||
      !zone ||
      !configurator ||
      !media ||
      !narrative
    ) {
      return { missingStructure: true };
    }

    const zoneRect = zone.getBoundingClientRect();
    const confRect = configurator.getBoundingClientRect();
    const mediaRect = media.getBoundingClientRect();
    const narrativeRect = narrative.getBoundingClientRect();
    const zoneStyle = getComputedStyle(zone);

    const contentLeft =
      zoneRect.left + px(zoneStyle.paddingLeft);

    const contentRight =
      zoneRect.right - px(zoneStyle.paddingRight);

    const usefulWidth = contentRight - contentLeft;

    const optionOverflow = Array.from(
      document.querySelectorAll('.k-vp')
    )
      .filter(
        (button) =>
          button.scrollWidth > button.clientWidth + 1 ||
          button.scrollHeight > button.clientHeight + 1
      )
      .map((button) => button.textContent.trim());

    const deliveryOverflow = Array.from(
      document.querySelectorAll('.k-dsel-btn')
    )
      .filter((button) => {
        const label = button.querySelector('.k-dsel-label');

        return (
          button.scrollWidth > button.clientWidth + 1 ||
          button.scrollHeight > button.clientHeight + 1 ||
          Boolean(
            label &&
              label.scrollWidth > label.clientWidth + 1
          )
        );
      })
      .map((button) => button.textContent.trim());

    return {
      missingStructure: false,

      modalOverflow:
        modal.scrollWidth > modal.clientWidth + 1,

      mediaPosition: getComputedStyle(media).position,

      heroTopDifference: Math.abs(
        mediaRect.top - narrativeRect.top
      ),

      configuratorBelowHero:
        confRect.top >=
        Math.max(mediaRect.bottom, narrativeRect.bottom) - 3,

      configuratorUsefulRatio:
        usefulWidth > 0
          ? confRect.width / usefulWidth
          : 0,

      configuratorLeftDifference: Math.abs(
        confRect.left - contentLeft
      ),

      configuratorRightDifference: Math.abs(
        confRect.right - contentRight
      ),

      optionOverflow,
      deliveryOverflow,
    };
  });
}

for (const viewport of VIEWPORTS) {
  test.describe(
    `Clôture desktop responsive — ${viewport.key}`,
    () => {
      test.use({
        viewport: {
          width: viewport.width,
          height: viewport.height,
        },
      });

      for (const entry of catalogue.cases) {
        test(
          `${entry.key} — initial puis added`,
          async ({ page }) => {
            await stubFixtureCatalogue(page);
            await openFixtureFromSearch(page, entry);
            await expectCanonicalOrder(page);

            const initial = await measureDesktop(page);

            expect(initial.missingStructure).toBe(false);
            expect(initial.modalOverflow).toBe(false);

            expect(
              ['sticky', 'fixed']
            ).not.toContain(initial.mediaPosition);

            expect(
              initial.heroTopDifference
            ).toBeLessThanOrEqual(8);

            expect(
              initial.configuratorBelowHero
            ).toBe(true);

            expect(
              initial.configuratorUsefulRatio
            ).toBeGreaterThanOrEqual(0.98);

            expect(
              initial.configuratorLeftDifference
            ).toBeLessThanOrEqual(3);

            expect(
              initial.configuratorRightDifference
            ).toBeLessThanOrEqual(3);

            expect(
              initial.optionOverflow,
              `Options débordantes : ${initial.optionOverflow.join(', ')}`
            ).toEqual([]);

            expect(
              initial.deliveryOverflow,
              `Livraisons débordantes : ${initial.deliveryOverflow.join(', ')}`
            ).toEqual([]);

            await capture(
              page,
              `desktop-${viewport.key}-${entry.key}-initial.png`
            );

            if (entry.validSelection) {
              await selectOptions(
                page,
                entry.validSelection
              );
            }

            await expect(
              page.locator('#k-add-cart-btn')
            ).toBeEnabled();

            await addToCartFromModal(page);
            await assertNoOverlayOnActions(page);

            await expect(
              page.locator('#k-side-cart.has-items')
            ).toBeVisible();

            await expect(
              page.locator('#k-side-cart .k-sc-item')
            ).toHaveCount(1);

            const added = await measureDesktop(page);

            expect(added.modalOverflow).toBe(false);

            expect(
              added.configuratorUsefulRatio
            ).toBeGreaterThanOrEqual(0.98);

            expect(added.optionOverflow).toEqual([]);
            expect(added.deliveryOverflow).toEqual([]);

            await capture(
              page,
              `desktop-${viewport.key}-${entry.key}-added.png`
            );
          }
        );
      }
    }
  );
}