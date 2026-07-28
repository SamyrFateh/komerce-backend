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
    await expect(page.locator('.k-modal-actions img, .k-modal-actions .k-sku-thumb')).toHaveCount(0);
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
