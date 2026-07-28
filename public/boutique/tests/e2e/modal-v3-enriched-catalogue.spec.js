'use strict';

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { IS_REMOTE, addToCartFromModal } = require('./helpers/boutique.helpers');
const {
  catalogue,
  stubFixtureCatalogue,
  openFixtureFromSearch,
  selectOptions,
  expectCanonicalOrder,
} = require('./helpers/modal-v3-fixture-catalogue');

// Catalogue déterministe : il doit toujours tourner contre le serveur statique
// local et ses routes Playwright, jamais contre le catalogue live.
test.skip(IS_REMOTE, 'Le catalogue enrichi V3 est un oracle LOCAL déterministe.');
test.beforeEach(async ({ browserName }, testInfo) => {
  test.skip(
    browserName !== 'chromium' || testInfo.project.name !== 'Desktop Chrome',
    'Matrice interne desktop/mobile exécutée une seule fois sous Chromium.'
  );
});

const VIEWPORTS = [
  { key: 'desktop', width: 1440, height: 900 },
  { key: 'mobile', width: 390, height: 844 },
];
const SHOT_DIR = path.resolve(__dirname, '../../docs/_work/modal-v3-catalogue');

async function optionalShot(page, fileName) {
  if (!process.env.MODAL_V3_CATALOGUE_SHOTS) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.locator('#k-modal').screenshot({ path: path.join(SHOT_DIR, fileName) });
}

async function expectShellAndHero(page, viewport) {
  await expectCanonicalOrder(page);

  const geometry = await page.evaluate(() => {
    const modal = document.getElementById('k-modal');
    const scroll = document.querySelector('.k-modal-main');
    const actions = document.querySelector('.k-modal-actions');
    const image = document.querySelector('.k-modal-img-wrap');
    const zone = document.querySelector('.k-modal-product-zone');
    const configurator = document.getElementById('k-modal-configurator');
    const imageRect = image?.getBoundingClientRect();
    const detailsRect = document.querySelector('.k-modal-details')?.getBoundingClientRect();
    const zoneRect = zone?.getBoundingClientRect();
    const confRect = configurator?.getBoundingClientRect();
    return {
      imagePosition: image ? getComputedStyle(image).position : null,
      actionsDirectChild: actions?.parentElement === modal,
      actionsInsideScroll: Boolean(actions && scroll && scroll.contains(actions)),
      configuratorInsideScroll: Boolean(configurator && scroll && scroll.contains(configurator)),
      desktopGeometry: imageRect && detailsRect && zoneRect && confRect ? {
        heroBottom: Math.max(imageRect.bottom, detailsRect.bottom),
        confTop: confRect.top,
        confWidth: confRect.width,
        zoneWidth: zoneRect.width,
      } : null,
    };
  });

  expect(['sticky', 'fixed']).not.toContain(geometry.imagePosition);
  expect(geometry.configuratorInsideScroll).toBe(true);

  if (viewport.key === 'mobile') {
    expect(geometry.actionsDirectChild).toBe(true);
    expect(geometry.actionsInsideScroll).toBe(false);
  } else {
    expect(geometry.actionsDirectChild).toBe(false);
    expect(geometry.actionsInsideScroll).toBe(true);
    expect(geometry.desktopGeometry.confTop).toBeGreaterThanOrEqual(geometry.desktopGeometry.heroBottom - 3);
    expect(geometry.desktopGeometry.confWidth / geometry.desktopGeometry.zoneWidth).toBeGreaterThan(0.7);
  }
}

for (const viewport of VIEWPORTS) {
  test.describe(`Catalogue enrichi V3 — ${viewport.key}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const entry of catalogue.cases) {
      test(`${entry.key} — recherche → configuration → panier`, async ({ page }) => {
        await stubFixtureCatalogue(page);
        await openFixtureFromSearch(page, entry);

        await expect(page.locator('#k-modal-sku')).toContainText(entry.detail.product.reference);
        await expect(page.locator('[data-axis-key]')).toHaveCount(entry.expectedAxes);
        await expectShellAndHero(page, viewport);
        await optionalShot(page, `${viewport.key}-${entry.key}-initial.png`);

        if (entry.issueSelection) {
          await selectOptions(page, entry.issueSelection);
          await expect(page.locator('#k-add-cart-btn')).toBeDisabled();
        }

        if (entry.validSelection) {
          await selectOptions(page, entry.validSelection);
        }
        await expect(page.locator('#k-add-cart-btn')).toBeEnabled();

        await addToCartFromModal(page);
        await optionalShot(page, `${viewport.key}-${entry.key}-added.png`);

        if (viewport.key === 'desktop') {
          await expect(page.locator('#k-side-cart.has-items')).toBeVisible();
          await expect(page.locator('#k-side-cart .k-sc-item')).toHaveCount(1);
        } else {
          const shellState = await page.evaluate(() => {
            const modal = document.getElementById('k-modal');
            const actions = document.querySelector('.k-modal-actions');
            const scroll = document.querySelector('.k-modal-scroll');
            return {
              direct: actions?.parentElement === modal,
              outsideScroll: Boolean(actions && scroll && !scroll.contains(actions)),
            };
          });
          expect(shellState).toEqual({ direct: true, outsideScroll: true });
        }

        // Le stepper compact de la modale est une projection produit-id-first :
        // on le mesure uniquement sur la fixture SIMPLE. Les produits SKU gardent
        // leur garde transactionnelle et leur quantité se vérifie dans le side cart.
        if (viewport.key === 'desktop' && entry.detail.inventory_model === 'SIMPLE') {
          const qty = page.locator('.k-modal-actions--filled .k-qty');
          await expect(qty).toBeVisible();
          const width = await qty.evaluate((element) => element.getBoundingClientRect().width);
          expect(width).toBeGreaterThanOrEqual(120);
          expect(width).toBeLessThanOrEqual(145);
          await expect(page.locator('.k-modal-actions .k-buy-now-btn')).toBeVisible();
        }
      });
    }
  });
}

test.describe('Catalogue enrichi V3 — scénarios spécifiques', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('Golden Elite expose une combinaison inexistante sans fabriquer de SKU', async ({ page }) => {
    const entry = catalogue.cases.find((item) => item.key === 'elite');
    await stubFixtureCatalogue(page);
    await openFixtureFromSearch(page, entry);
    await selectOptions(page, { Couleur: 'Noir' });

    const size44 = page.locator('[data-axis-key="Taille"] button[data-option-value="44"]');
    await expect(size44).toHaveAttribute('data-option-state', 'INCOMPATIBLE');
    await size44.click();
    await expect(page.locator('#k-add-cart-btn')).toBeDisabled();
    await expect(page.locator('#k-modal-selection-message')).toContainText(/non proposée|combinaison/i);
  });

  test('la fixture de stress crée un scroll produit unique sans scroll imbriqué', async ({ page }) => {
    const entry = catalogue.cases.find((item) => item.key === 'stress');
    await stubFixtureCatalogue(page);
    await openFixtureFromSearch(page, entry);

    const measurements = await page.evaluate(() => {
      const main = document.querySelector('.k-modal-main');
      const candidates = [
        document.querySelector('.k-modal-product-zone'),
        document.getElementById('k-modal-configurator'),
        document.getElementById('k-modal-long-details'),
        document.getElementById('k-modal-enriched-content'),
        document.getElementById('k-modal-suggestions'),
      ].filter(Boolean);
      return {
        mainOverflow: main.scrollHeight > main.clientHeight,
        nestedScrollable: candidates.some((element) => {
          const style = getComputedStyle(element);
          return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
        }),
      };
    });

    expect(measurements.mainOverflow).toBe(true);
    expect(measurements.nestedScrollable).toBe(false);
  });
});
