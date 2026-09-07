'use strict';

/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */
const { test, expect } = require('@playwright/test');
const { IS_REMOTE } = require('./helpers/boutique.helpers');
const { stubFixtureCatalogue } = require('./helpers/modal-v3-fixture-catalogue');

test.skip(
  IS_REMOTE,
  'Matrice responsive catalogue : oracle local déterministe uniquement.'
);

const VIEWPORTS = [
  { key: '900x600', width: 900, height: 600 },
  { key: '900x800', width: 900, height: 800 },
  { key: '1024x600', width: 1024, height: 600 },
  { key: '1024x768', width: 1024, height: 768 },
  { key: '1180x820', width: 1180, height: 820 },
  { key: '1280x720', width: 1280, height: 720 },
  { key: '1280x800', width: 1280, height: 800 },
  { key: '1366x768', width: 1366, height: 768 },
  { key: '1440x900', width: 1440, height: 900 },
  { key: '1536x864', width: 1536, height: 864 },
  { key: '1600x900', width: 1600, height: 900 },
  { key: '1920x1080', width: 1920, height: 1080 },
  { key: '2560x1440', width: 2560, height: 1440 },
];

for (const viewport of VIEWPORTS) {
  test.describe(`Catalogue responsive — ${viewport.key}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('garde une géométrie desktop exploitable avec et sans réserve panier', async ({ page }) => {
      await stubFixtureCatalogue(page);
      await page.goto('/boutique/index.html', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window._kbus && window._kstate, null, { timeout: 8_000 });
      await page.waitForSelector('#k-grid .k-card', { state: 'attached', timeout: 8_000 });

      const before = await page.evaluate(() => ({
        viewport: window.innerWidth,
        docOverflow: document.documentElement.scrollWidth - window.innerWidth,
      }));
      expect(before.viewport).toBe(viewport.width);
      expect(before.docOverflow).toBeLessThanOrEqual(1);

      const geometry = await page.evaluate(() => {
        const sideCart = document.getElementById('k-side-cart');
        const catalog = document.getElementById('k-catalog-section');
        const header = document.querySelector('.k-header-inner');
        const shelf = document.querySelector('.k-shelf-rail');
        const grids = Array.from(document.querySelectorAll('.k-sec-grid, #k-grid'));
        const grid = grids.find((candidate) => {
          const style = getComputedStyle(candidate);
          const rect = candidate.getBoundingClientRect();
          return style.display === 'grid' && rect.width > 0;
        });

        if (!sideCart || !catalog || !grid) return { missing: true };

        document.body.classList.add('sc-reserve');
        sideCart.classList.add('has-items');

        const sideRect = sideCart.getBoundingClientRect();
        const catalogRect = catalog.getBoundingClientRect();
        const headerRect = header?.getBoundingClientRect() || null;
        const gridStyle = getComputedStyle(grid);
        const columns = gridStyle.gridTemplateColumns
          .split(/\s+/)
          .filter(Boolean)
          .length;
        const firstCard = grid.querySelector('.k-card');
        const cardRect = firstCard?.getBoundingClientRect() || null;
        const reserve = Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue('--sc-reserve-w')
        ) || 0;

        return {
          missing: false,
          columns,
          reserve,
          sideWidth: sideRect.width,
          catalogRight: catalogRect.right,
          sideLeft: sideRect.left,
          headerRight: headerRect?.right || 0,
          cardWidth: cardRect?.width || 0,
          shelfOverflow: shelf ? shelf.scrollWidth - shelf.clientWidth : 0,
          docOverflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      });

      expect(geometry.missing).toBe(false);
      expect(geometry.docOverflow).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.sideWidth - geometry.reserve)).toBeLessThanOrEqual(2);
      expect(geometry.catalogRight).toBeLessThanOrEqual(geometry.sideLeft + 2);
      if (geometry.headerRight) {
        expect(geometry.headerRight).toBeLessThanOrEqual(geometry.sideLeft + 2);
      }

      if (viewport.width < 1200) {
        expect(geometry.columns).toBe(3);
        expect(geometry.cardWidth).toBeGreaterThanOrEqual(180);
      } else {
        expect(geometry.columns).toBeGreaterThanOrEqual(3);
        expect(geometry.cardWidth).toBeGreaterThanOrEqual(250);
      }

      expect(geometry.cardWidth).toBeLessThanOrEqual(360);
      expect(geometry.shelfOverflow).toBeLessThanOrEqual(2);
    });
  });
}
