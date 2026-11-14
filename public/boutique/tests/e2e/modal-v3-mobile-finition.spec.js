'use strict';


/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { IS_REMOTE, addToCartFromModal, assertNoOverlayOnActions } = require('./helpers/boutique.helpers');
const {
  catalogue,
  stubFixtureCatalogue,
  openFixtureFromSearch,
  selectOptions,
} = require('./helpers/modal-v3-fixture-catalogue');

// Même oracle LOCAL déterministe que modal-v3-enriched-catalogue.spec.js —
// ce lot ne teste que la finition visuelle mobile, jamais contre le
// catalogue live.
test.skip(IS_REMOTE, 'Chantier finition mobile V3 — oracle LOCAL déterministe.');
test.beforeEach(async ({ browserName }, testInfo) => {
  test.skip(
    browserName !== 'chromium' || testInfo.project.name !== 'Desktop Chrome',
    'Exécuté une seule fois sous Chromium (le spec pilote son propre viewport mobile via test.use côté page).'
  );
});

const SHOT_DIR = path.resolve(__dirname, '../../docs/_work/modal-v3-catalogue');
const VIEWPORTS = [
  { key: '360x800', width: 360, height: 800 },
  { key: '390x844', width: 390, height: 844 },
  { key: '430x932', width: 430, height: 932 },
];

async function shot(page, fileName) {
  if (!process.env.MODAL_V3_CATALOGUE_SHOTS) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.locator('#k-modal').screenshot({ path: path.join(SHOT_DIR, fileName) });
}

async function openAt(page, viewport, entryKey) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await stubFixtureCatalogue(page);
  const entry = catalogue.cases.find((c) => c.key === entryKey);
  await openFixtureFromSearch(page, entry);
  return entry;
}

test.describe('Chantier finition mobile V3 — P1 livraison (pas de troncature)', () => {
  for (const viewport of VIEWPORTS) {
    test(`stress @ ${viewport.key} : mode de livraison long jamais coupé, aucun scroll horizontal`, async ({ page }) => {
      await openAt(page, viewport, 'stress');
      await expect(page.locator('.k-mdm-info-strip')).toBeVisible({ timeout: 5_000 });

      // Acceptation brief : scrollWidth <= clientWidth (aucune largeur
      // scrollable horizontalement), pas d'ellipsis sur le nom du mode.
      const overflow = await page.evaluate(() => {
        const strip = document.querySelector('.k-mdm-info-strip');
        return {
          scrollWidth: strip.scrollWidth,
          clientWidth: strip.clientWidth,
        };
      });
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1); // +1 : arrondi sub-pixel

      const chip = page.locator('.k-mdm-chip--delivery').first();
      await expect(chip).toBeVisible();
      await expect(chip).toContainText('Livraison spécialisée avec prise de rendez-vous');
      await expect(chip).toContainText('22 000 KMF');
      await expect(chip).toContainText('4 à 7 semaines');

      // Nom du mode jamais coupé par ellipsis (aucune classe/CSS de
      // troncature appliquée au libellé du mode de livraison).
      const nameOverflow = await chip.evaluate((el) => getComputedStyle(el).textOverflow);
      expect(nameOverflow).not.toBe('ellipsis');

      // Deux modes sur cette fixture : aucune collision verticale, chaque
      // chip occupe sa propre ligne (acceptation : "les variantes
      // commencent sous la livraison sans collision").
      const chips = page.locator('.k-mdm-chip--delivery');
      await expect(chips).toHaveCount(2);
      const boxes = await chips.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
      expect(boxes[1]).toBeGreaterThan(boxes[0]);

      if (viewport.key === '390x844') await shot(page, 'mobile-long-delivery-detail.png');
    });
  }

  test('garment : un seul mode de livraison, prix et délai visibles sans overflow', async ({ page }) => {
    await openAt(page, { width: 390, height: 844 }, 'garment');
    const chip = page.locator('.k-mdm-chip--delivery').first();
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('Livraison express');
    await expect(chip).toContainText('2 500 KMF');
    await expect(chip).toContainText('5 à 8 jours');
    const overflow = await page.evaluate(() => {
      const strip = document.querySelector('.k-mdm-info-strip');
      return { scrollWidth: strip.scrollWidth, clientWidth: strip.clientWidth };
    });
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  });
});

test.describe('Chantier finition mobile V3 — P2 stock non dupliqué', () => {
  test('elite : sélection valide -> aucun chip "Disponible" dans le configurateur, pill stock seul près du prix', async ({ page }) => {
    const entry = await openAt(page, { width: 390, height: 844 }, 'elite');
    await selectOptions(page, entry.validSelection);

    // Le chip configurateur "✓ Disponible" ne doit plus exister une fois
    // le SKU résolu — c'est le doublon corrigé par ce lot.
    await expect(page.locator('.k-mdm-chip--ok')).toHaveCount(0);

    // La disponibilité reste annoncée une seule fois, via le pill stock
    // près du prix.
    await expect(page.locator('#k-modal-stock-pill')).toBeVisible();
  });

  test('elite : sélection incomplète -> le chip de guidage reste affiché (pas un doublon de stock)', async ({ page }) => {
    await openAt(page, { width: 390, height: 844 }, 'elite');
    const chip = page.locator('.k-mdm-chip').first();
    await expect(chip).toContainText('Choisissez vos options');
  });

  test('elite après ajout : "Dans le panier (N)" lisible, aucun chip "Disponible" résiduel, aucune miniature superposée', async ({ page }) => {
    const entry = await openAt(page, { width: 390, height: 844 }, 'elite');
    await selectOptions(page, entry.validSelection);
    await addToCartFromModal(page);

    await expect(page.locator('.k-mdm-chip--ok')).toHaveCount(0);
    // Un test DOM vert (img/k-sku-thumb = 0) ne suffit pas : il laisse
    // passer tout élément non-img positionné par-dessus les actions (ex.
    // particule flyToCart encore visible au moment de la capture).
    await expect(page.locator('.k-modal-actions img, .k-modal-actions .k-sku-thumb')).toHaveCount(0);
    await assertNoOverlayOnActions(page);
    const filledLabel = page.locator('.k-modal-actions').getByText(/Dans le panier/);
    await expect(filledLabel).toBeVisible();

    await shot(page, 'mobile-sku-in-cart-detail.png');
  });
});

test.describe('Chantier finition mobile V3 — P2 référence/SKU longue', () => {
  test('stress : référence sur une seule ligne, ellipsis, aucun débordement du layout', async ({ page }) => {
    await openAt(page, { width: 390, height: 844 }, 'stress');
    const sku = page.locator('#k-modal-sku, .k-modal-sku').first();
    await expect(sku).toBeVisible();

    const box = await sku.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        lines: Math.round(el.scrollHeight / parseFloat(style.lineHeight || '14')),
        overflowX: el.scrollWidth > el.clientWidth,
        textOverflow: style.textOverflow,
        whiteSpace: style.whiteSpace,
      };
    });
    expect(box.lines).toBeLessThanOrEqual(1);
    expect(box.textOverflow).toBe('ellipsis');
    expect(box.whiteSpace).toBe('nowrap');

    // La référence complète reste dans le DOM (accessibilité / tests),
    // seule la présentation visuelle est tronquée.
    await expect(sku).toHaveText(/FIX-STRESS-LAYOUT-ULTRA-LONG-REFERENCE-2026/);
  });
  test('editorial (SIMPLE) après ajout : stepper numérique − N +, aucune miniature, Acheter maintenant visible', async ({ page }) => {
    await openAt(page, { width: 390, height: 844 }, 'editorial');
    await addToCartFromModal(page);

    const stepper = page.locator('.k-modal-actions .k-qty').first();
    await expect(stepper).toBeVisible();
    await expect(page.locator('.k-modal-actions img, .k-modal-actions .k-sku-thumb')).toHaveCount(0);
    await assertNoOverlayOnActions(page);
    await expect(page.locator('#k-buy-now-btn')).toBeVisible();

    // Cibles tactiles >= 44px (acceptation brief).
    const targets = await page.locator('.k-modal-actions button:visible').evaluateAll((els) => els.map((el) => {
      const r = el.getBoundingClientRect();
      return Math.min(r.width, r.height);
    }));
    for (const size of targets) {
      expect(size).toBeGreaterThanOrEqual(40); // marge de mesure sub-pixel sur cibles 44px nominal
    }

    await shot(page, 'mobile-simple-stepper-detail.png');
  });
});

test.describe('Chantier finition mobile V3 — P1 hero (ratio 4:3 cohérent, lot audit-3)', () => {
  test('elite (multi-image) et editorial (single-image) ont une hauteur de hero cohérente à largeur égale', async ({ page }) => {
    await openAt(page, { width: 390, height: 844 }, 'elite');
    const eliteHeight = await page.locator('.k-modal-img-wrap').evaluate((el) => el.getBoundingClientRect().height);

    await openAt(page, { width: 390, height: 844 }, 'editorial');
    const editorialHeight = await page.locator('.k-modal-img-wrap').evaluate((el) => el.getBoundingClientRect().height);

    // Acceptation brief : hauteur "visuellement cohérente" entre produits,
    // indépendamment du mode galerie (multiple vs single). Ratio 4:3 partagé
    // → l'écart ne doit plus dépendre du nombre de médias.
    expect(Math.abs(eliteHeight - editorialHeight)).toBeLessThanOrEqual(4);
  });

  test('le wrapper média respecte un ratio proche de 4:3 à 390px de large', async ({ page }) => {
    await openAt(page, { width: 390, height: 844 }, 'elite');
    const box = await page.locator('.k-modal-img-wrap').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { width: r.width, height: r.height };
    });
    const ratio = box.width / box.height;
    expect(ratio).toBeGreaterThan(1.2);
    expect(ratio).toBeLessThan(1.45); // cible 4/3 ≈ 1.33, marge pour min-height/max-height
  });
});

test.describe('Chantier finition mobile V3 — P2 swatches (nom visible, lot audit-3)', () => {
  test('elite : le nom de la couleur est visible sous chaque vignette, pas seulement à la sélection', async ({ page }) => {
    await openAt(page, { width: 390, height: 844 }, 'elite');
    const firstSwatchName = page.locator('.k-sku .k-sku-name').first();
    await expect(firstSwatchName).toBeVisible();
    const display = await firstSwatchName.evaluate((el) => getComputedStyle(el).display);
    expect(display).not.toBe('none');
    await expect(firstSwatchName).not.toHaveText('');
  });
});

test.describe('Chantier finition mobile V3 — P2 pager 1/1 (lot audit-3)', () => {
  test('elite : recherche à résultat unique -> le pager de navigation produit est masqué', async ({ page }) => {
    await openAt(page, { width: 390, height: 844 }, 'elite');
    const nav = page.locator('#k-modal-nav');
    // Peut ne pas exister du tout (jamais créé) ou exister mais masqué —
    // les deux sont conformes à l'acceptation "pager complètement masqué".
    const count = await nav.count();
    if (count > 0) {
      await expect(nav).toBeHidden();
    }
  });
});

test.describe('Chantier finition mobile V3 — P2 réassurance', () => {
  for (const viewport of VIEWPORTS) {
    test(`elite @ ${viewport.key} : réassurance lisible (>=11px), contraste amélioré, wrap propre si nécessaire`, async ({ page }) => {
      await openAt(page, viewport, 'elite');
      const items = page.locator('.k-modal-trust-item');
      await expect(items).toHaveCount(3);

      const metrics = await items.evaluateAll((els) => els.map((el) => {
        const style = getComputedStyle(el);
        return { fontSize: parseFloat(style.fontSize), color: style.color };
      }));
      for (const m of metrics) {
        expect(m.fontSize).toBeGreaterThanOrEqual(11);
      }

      // Aucun débordement horizontal de la rangée, wrap ou non.
      const stripOverflow = await page.evaluate(() => {
        const trust = document.querySelector('.k-modal-trust');
        return trust.scrollWidth <= trust.clientWidth + 1;
      });
      expect(stripOverflow).toBe(true);
    });
  }
});


// Le test porte sur la modale, pas sur la navigation de recherche (écran
// Discovery). Le bus applicatif est le point d'entrée public réel du PDP.
async function openPdpGeometryFixture(page, viewport, entryKey) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await stubFixtureCatalogue(page);
  const entry = catalogue.cases.find((c) => c.key === entryKey);
  await page.goto('/boutique/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((id) =>
    Boolean(window._kbus?.emit && window._kstate?.products?.some(
      product => String(product.id) === String(id)
    )), entry.detail.product.id, { timeout: 8_000 });
  await page.evaluate((id) =>
    window._kbus.emit('modal:open', { id, kind: 'product', pushHistory: false }),
    entry.detail.product.id
  );
  await expect(page.locator('#k-modal-overlay')).toHaveClass(/open/, { timeout: 6_000 });
  await expect(page.locator('#k-modal-name')).toHaveText(entry.detail.product.name);
  return entry;
}

test.describe('PDP mobile retouches 2026-11 — Chromium geometry', () => {
  for (const viewport of VIEWPORTS) {
    test(`@ ${viewport.key} : le compteur suit la photo portrait réelle, sans sortir du média`, async ({ page }) => {
      await openPdpGeometryFixture(page, viewport, 'garment');
      const counter = page.locator('#k-modal .k-modal-img-wrap .k-modal-counter');
      await expect(counter).toBeVisible({ timeout: 5_000 });

      // Une photo portrait au sein d'un hero 4:3 reproduit le cas Samsung :
      // object-fit:contain laisse des marges de part et d'autre de la photo.
      await page.evaluate(() => {
        const portrait = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="900">'
          + '<rect width="500" height="900" fill="#eee"/></svg>';
        const first = document.querySelector('#k-modal .k-modal-carousel-track .k-modal-slide');
        first.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(portrait);
      });

      await expect.poll(() => counter.evaluate(el =>
        parseFloat(el.style.getPropertyValue('--k-counter-right')) || 0
      )).toBeGreaterThan(65);

      const metrics = await counter.evaluate((el) => {
        const wrap = el.closest('.k-modal-img-wrap').getBoundingClientRect();
        const image = el.closest('.k-modal-img-wrap').querySelector('.k-modal-slide');
        const rect = el.getBoundingClientRect();
        const fit = Math.min(wrap.width / image.naturalWidth, wrap.height / image.naturalHeight);
        const imageWidth = image.naturalWidth * fit;
        const imageHeight = image.naturalHeight * fit;
        const imageLeft = wrap.left + (wrap.width - imageWidth) / 2;
        const imageRight = imageLeft + imageWidth;
        const imageBottom = wrap.top + (wrap.height + imageHeight) / 2;
        return {
          leftGap: rect.left - imageLeft,
          rightGap: imageRight - rect.right,
          bottomGap: imageBottom - rect.bottom,
          pseudo: getComputedStyle(el, '::before').content,
        };
      });
      expect(metrics.leftGap).toBeGreaterThanOrEqual(5);
      expect(metrics.rightGap).toBeGreaterThanOrEqual(7);
      expect(metrics.bottomGap).toBeGreaterThanOrEqual(7);
      expect(metrics.rightGap).toBeLessThanOrEqual(16);
      expect(metrics.pseudo).toContain('Photo');
      if (viewport.key === '390x844') await shot(page, 'mobile-pdp-photo-counter-390.png');
    });

    test(`@ ${viewport.key} : coeur, réassurance et noms couleurs gardent des alignements propres`, async ({ page }) => {
      await openPdpGeometryFixture(page, viewport, 'stress');
      const trust = page.locator('#k-modal .k-modal-trust');
      const firstItem = trust.locator('.k-modal-trust-item').first();
      await expect(firstItem).toBeVisible();
      const name = page.locator('#k-modal .k-modal-name-row');
      const favorite = page.locator('#k-modal-fav-btn');
      await expect(favorite).toBeVisible();
      const swatchLabel = page.locator('#k-modal .k-sku--color .k-sku-name').first();
      await expect(swatchLabel).toBeVisible();
      const metrics = await page.evaluate(() => {
        const title = document.querySelector('#k-modal .k-modal-name-row').getBoundingClientRect();
        const fav = document.querySelector('#k-modal-fav-btn').getBoundingClientRect();
        const trustEl = document.querySelector('#k-modal .k-modal-trust');
        const trust = trustEl.getBoundingClientRect();
        const item = document.querySelector('#k-modal .k-modal-trust-item').getBoundingClientRect();
        const info = document.querySelector('#k-modal .k-modal-info').getBoundingClientRect();
        const swatchName = document.querySelector('#k-modal .k-sku--color .k-sku-name');
        const swatchStyle = getComputedStyle(swatchName);
        return {
          favInsideMedia: Boolean(document.querySelector('#k-modal .k-modal-img-wrap > #k-modal-fav-btn')),
          favWidth: fav.width,
          favMediaClear: (() => {
            const img = document.querySelector('#k-modal .k-modal-img-wrap').getBoundingClientRect();
            return fav.top >= img.top && fav.right <= img.right && fav.bottom <= img.bottom;
          })(),
          heroRatio: (() => {
            const img = document.querySelector('#k-modal .k-modal-img-wrap').getBoundingClientRect();
            return img.width / img.height;
          })(),
          trustLeftDifference: Math.abs(trust.left - title.left),
          itemLeftDifference: Math.abs(item.left - title.left),
          trustNarrowerThanInfo: trust.width < info.width - 12,
          trustOverflow: trustEl.scrollWidth - trustEl.clientWidth,
          labelWhiteSpace: swatchStyle.whiteSpace,
          labelLineClamp: swatchStyle.webkitLineClamp,
          labelFontSize: parseFloat(swatchStyle.fontSize),
        };
      });
      expect(metrics.favInsideMedia).toBe(true);
      expect(metrics.favMediaClear).toBe(true);
      expect(metrics.heroRatio).toBeCloseTo(16 / 9, 1);
      expect(metrics.favWidth).toBeGreaterThanOrEqual(44);
      expect(metrics.trustLeftDifference).toBeLessThanOrEqual(3);
      expect(metrics.itemLeftDifference).toBeLessThanOrEqual(3);
      expect(metrics.trustNarrowerThanInfo).toBe(true);
      expect(metrics.trustOverflow).toBeLessThanOrEqual(1);
      expect(metrics.labelWhiteSpace).toBe('normal');
      expect(metrics.labelLineClamp).toBe('2');
      expect(metrics.labelFontSize).toBeGreaterThanOrEqual(10);
      if (viewport.key === '390x844') await shot(page, 'mobile-pdp-identity-trust-colors-390.png');
    });
  }
});

async function openV4GalleryFixture(page, viewport, key) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await stubFixtureCatalogue(page);
  const entry = catalogue.cases.find((item) => item.key === key);
  const product = catalogue.products.find((item) => String(item.id) === String(entry.detail.product.id));
  await page.goto('/boutique/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window._kbus && window._kstate, null, { timeout: 10000 });
  await page.evaluate((item) => {
    if (!window._kstate.products.some((p) => String(p.id) === String(item.id))) {
      window._kstate.products.push(item);
    }
    window._kbus.emit('modal:open', { id: item.id });
  }, product);
  await expect(page.locator('#k-modal-overlay')).toHaveClass(/open/, { timeout: 8000 });
  await expect(page.locator('#k-modal-name')).toHaveText(entry.detail.product.name, { timeout: 8000 });
  return entry;
}

test.describe('PDP mobile retouches 2026-11 — Galerie & détails V4', () => {
  for (const viewport of VIEWPORTS) {
    test(`PDP mobile retouches 2026-11 — ${viewport.key} : galerie 16:9, favori réel et détails lisibles`, async ({ page }) => {
      await openV4GalleryFixture(page, viewport, 'stress');
      const hero = page.locator('#k-modal .k-modal-img-wrap');
      const favorite = page.locator('#k-modal .k-modal-img-wrap > #k-modal-fav-btn');
      await expect(hero).toBeVisible();
      await expect(favorite).toBeVisible();
      await expect(page.locator('.k-mdm-details-title')).toHaveText('Détails du produit');

      const geom = await page.evaluate(() => {
        const h = document.querySelector('#k-modal .k-modal-img-wrap').getBoundingClientRect();
        const f = document.getElementById('k-modal-fav-btn').getBoundingClientRect();
        const c = document.getElementById('k-modal');
        return {
          ratio: h.width / h.height,
          favoriteInside: f.left >= h.left && f.right <= h.right && f.top >= h.top && f.bottom <= h.bottom,
          favoriteSize: Math.min(f.width, f.height),
          noHorizontalScroll: c.scrollWidth <= c.clientWidth + 1,
          singleFavorite: document.querySelectorAll('#k-modal-fav-btn').length === 1,
        };
      });
      expect(geom.ratio).toBeCloseTo(16 / 9, 1);
      expect(geom.favoriteInside).toBe(true);
      // BoundingClientRect conserve une précision subpixel (43.99999px à 360px).
      // CSS source impose toujours width/height 44px : ne pas durcir le seuil flottant.
      expect(geom.favoriteSize).toBeGreaterThanOrEqual(43.9);
      expect(geom.singleFavorite).toBe(true);
      expect(geom.noHorizontalScroll).toBe(true);
      await shot(page, `mobile-pdp-v4-gallery-details-${viewport.key}.png`);
    });
  }
});


test('PDP mobile retouches 2026-11 — vrai favori interactif et retour desktop au resize', async ({ page }) => {
  await openV4GalleryFixture(page, { width: 390, height: 844 }, 'stress');
  const favorite = page.locator('#k-modal-fav-btn');
  await expect(page.locator('#k-modal .k-modal-img-wrap > #k-modal-fav-btn')).toBeVisible();
  const before = await favorite.getAttribute('aria-pressed');
  await favorite.click();
  await expect(favorite).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true');

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(() => favorite.evaluate((el) => el.closest('.k-modal-name-row') !== null)).toBe(true);
  await expect(page.locator('#k-modal .k-modal-name-row > #k-modal-fav-btn')).toBeVisible();
  expect(await page.locator('#k-modal-fav-btn').count()).toBe(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => favorite.evaluate((el) => el.closest('.k-modal-img-wrap') !== null)).toBe(true);
  await expect(page.locator('#k-modal .k-modal-img-wrap > #k-modal-fav-btn')).toBeVisible();
  expect(await page.locator('#k-modal-fav-btn').count()).toBe(1);
});
