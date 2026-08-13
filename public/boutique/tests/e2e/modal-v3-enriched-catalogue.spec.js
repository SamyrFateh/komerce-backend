'use strict';


/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { IS_REMOTE, addToCartFromModal, assertNoOverlayOnActions, closeModal } = require('./helpers/boutique.helpers');
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
    const buybox = document.getElementById('k-modal-buybox');
    const imageRect = image?.getBoundingClientRect();
    const buyboxRect = buybox?.getBoundingClientRect();
    const actionsRect = actions?.getBoundingClientRect();
    const configuratorDisplay = configurator ? getComputedStyle(configurator).display : null;
    return {
      imagePosition: image ? getComputedStyle(image).position : null,
      actionsDirectChild: actions?.parentElement === modal,
      actionsInsideScroll: Boolean(actions && scroll && scroll.contains(actions)),
      configuratorInsideScroll: Boolean(configurator && scroll && scroll.contains(configurator)),
      desktopGeometry: imageRect && buyboxRect && actionsRect ? {
        imageTop: imageRect.top,
        imageRight: imageRect.right,
        buyboxTop: buyboxRect.top,
        buyboxLeft: buyboxRect.left,
        buyboxRight: buyboxRect.right,
        buyboxWidth: buyboxRect.width,
        configuratorDisplay,
        actionsLeft: actionsRect.left,
        actionsRight: actionsRect.right,
        actionsWidth: actionsRect.width,
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
    const g = geometry.desktopGeometry;
    expect(g).not.toBeNull();

    // PDP v3.1 : ProductMedia | ProductBuyBox partagent la premiere ligne.
    expect(Math.abs(g.buyboxTop - g.imageTop)).toBeLessThanOrEqual(3);
    expect(g.buyboxLeft).toBeGreaterThanOrEqual(g.imageRight - 3);

    // PDP v3.1 Lot 4C : le wrapper configurateur est transparent au layout.
    // Sa géométrie propre est donc 0x0 ; on vérifie la vraie boîte des actions.
    expect(g.configuratorDisplay).toBe('contents');
    expect(g.actionsLeft).toBeGreaterThanOrEqual(g.buyboxLeft - 1);
    expect(g.actionsRight).toBeLessThanOrEqual(g.buyboxRight + 1);
    expect(g.actionsWidth).toBeLessThanOrEqual(g.buyboxWidth + 1);
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
        // Un test DOM vert (ex. `.k-modal-actions img = 0`) ne suffit pas :
        // il laisse passer tout élément non-img positionné par-dessus (ex.
        // particule flyToCart encore visible). On vérifie ici l'absence
        // réelle de chevauchement, pas seulement la structure DOM attendue.
        await assertNoOverlayOnActions(page);
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

  test('P2 — stress : aucun texte d’option ne déborde de sa boîte, quelle que soit la longueur du libellé', async ({ page }) => {
    const entry = catalogue.cases.find((item) => item.key === 'stress');
    await stubFixtureCatalogue(page);
    await openFixtureFromSearch(page, entry);

    // Un test DOM vert sur la présence de bounding boxes distinctes ne
    // suffit pas : la boîte peut être correcte pendant que le texte peint
    // déborde visuellement (white-space:nowrap + hauteur fixe, sans
    // overflow). On vérifie ici le rendu réel de chaque bouton d'option
    // texte (.k-vp), pour tous les axes de la fixture la plus dense
    // (4 axes, libellés longs type "Passe-câbles simple").
    const overflowing = await page.evaluate(() => {
      const offenders = [];
      document.querySelectorAll('.k-vp').forEach((btn) => {
        if (btn.scrollWidth > btn.clientWidth + 1 || btn.scrollHeight > btn.clientHeight + 1) {
          offenders.push(btn.textContent.trim());
        }
      });
      return offenders;
    });
    expect(overflowing, `Option(s) débordant de leur boîte : ${overflowing.join(', ')}`).toEqual([]);

    await optionalShot(page, 'desktop-stress-options-detail.png');
  });

  test('P3 — stress : les deux modes de livraison restent lisibles, aucun libellé comprimé', async ({ page }) => {
    const entry = catalogue.cases.find((item) => item.key === 'stress');
    await stubFixtureCatalogue(page);
    await openFixtureFromSearch(page, entry);

    const dsel = page.locator('.k-dsel-btn');
    await expect(dsel).toHaveCount(2);

    const measurements = await dsel.evaluateAll((buttons) => buttons.map((btn) => {
      const label = btn.querySelector('.k-dsel-label');
      return {
        text: label?.textContent.trim() || '',
        width: btn.getBoundingClientRect().width,
        labelOverflow: label ? label.scrollWidth > label.clientWidth + 1 : false,
      };
    }));

    for (const m of measurements) {
      // Plancher de lisibilité (flex-basis 220px) : un mode ne doit jamais
      // se retrouver comprimé sous ce seuil quel que soit le nombre total
      // de modes exposés par le contrat.
      expect(m.width, `${m.text} — largeur ${m.width}px`).toBeGreaterThanOrEqual(200);
      expect(m.labelOverflow, `${m.text} — libellé débordant`).toBe(false);
    }

    await optionalShot(page, 'desktop-stress-delivery-detail.png');
  });

  test('P5 — side cart : trois articles distincts s’affichent sans chevauchement ni troncature de prix', async ({ page }) => {
    await stubFixtureCatalogue(page);

    const elite = catalogue.cases.find((item) => item.key === 'elite');
    const garment = catalogue.cases.find((item) => item.key === 'garment');
    const editorial = catalogue.cases.find((item) => item.key === 'editorial');

    await openFixtureFromSearch(page, elite);
    await selectOptions(page, elite.validSelection);
    await addToCartFromModal(page);
    await assertNoOverlayOnActions(page);
    await closeModal(page);

    await openFixtureFromSearch(page, garment);
    await selectOptions(page, garment.validSelection);
    await addToCartFromModal(page);
    await assertNoOverlayOnActions(page);
    await closeModal(page);

    await openFixtureFromSearch(page, editorial);
    await addToCartFromModal(page);
    await assertNoOverlayOnActions(page);

    const items = page.locator('#k-side-cart .k-sc-item');
    await expect(items).toHaveCount(3);

    const boxes = await items.evaluateAll((els) => els.map((el) => {
      const rect = el.getBoundingClientRect();
      const priceWrap = el.querySelector('.k-sc-item-price-wrap');
      return {
        rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
        priceOverflow: priceWrap ? priceWrap.scrollWidth > priceWrap.clientWidth + 1 : false,
      };
    }));

    function intersects(a, b) {
      return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
    }
    for (let i = 0; i < boxes.length; i++) {
      expect(boxes[i].priceOverflow, `article ${i} — prix tronqué`).toBe(false);
      for (let j = i + 1; j < boxes.length; j++) {
        expect(intersects(boxes[i].rect, boxes[j].rect), `articles ${i}/${j} se chevauchent`).toBe(false);
      }
    }

    await optionalShot(page, 'desktop-side-cart-three-items.png');
  });

  test('P6 — elite Noir/42 : la combinaison réelle en stock faible affiche "Plus que 4"', async ({ page }) => {
    const entry = catalogue.cases.find((item) => item.key === 'elite');
    await stubFixtureCatalogue(page);
    await openFixtureFromSearch(page, entry);

    // Combinaison retrouvée depuis la fixture réelle (sellable_units[],
    // available_quantity: 4), jamais injectée dans le DOM — cf. garde-fous.
    await selectOptions(page, { Couleur: 'Noir', Taille: '42' });

    const stock = page.locator('#k-modal-stock');
    await expect(stock).toBeVisible();
    await expect(stock).toHaveText('● Plus que 4');
    await expect(stock).toHaveClass(/k-modal-stock--low/);

    await optionalShot(page, 'desktop-low-stock-detail.png');
  });
});
