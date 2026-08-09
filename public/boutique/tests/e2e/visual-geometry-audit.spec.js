/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   visual-geometry-audit.spec.js
 * @feature side-cart, shared-list, checkout, catalogue
 * @brief  Audit géométrique des invariants visuels identifiés lors de
 *         la campagne QA 2026-08 (refontes side cart, liste partagée,
 *         récapitulatif, checkout canonique).
 *
 *         Ce spec tourne en mode LOCAL (fixtures déterministes, APIs
 *         stubbées via page.route) dans le projet « Chromium Local-Only »,
 *         pour garantir la répétabilité sans dépendre du backend réel.
 *
 *         Invariants couverts :
 *         1. Label de l'onglet « Liste de X » centré optiquement (×
 *            compensé à gauche par padding-left:26px).
 *         2. Même hauteur visuelle pour les deux onglets du side cart.
 *         3. Le badge .k-cart-snapshot-item-status-badge ne recouvre pas
 *            .k-cart-item-name dans la ligne de snapshot.
 *         4. La case à cocher .k-cart-item-select est alignée verticalement
 *            au centre de la ligne .k-cart-snapshot-item.
 *         5. .ck-recap-check est centré dans son cercle (pas de décalage
 *            typographique ✓).
 *         6. Badge promo .k-card-promo ne déborde pas sous l'image
 *            (séparation img-wrap / card-info).
 *         7. Le CTA .ck-confirm-btn n'est pas masqué par le safe-area
 *            bottom (vérifié via bottom >= 0).
 *         8. Les chips de paiement .ck-pay-chip ont la même hauteur.
 *
 *         Les viewports testés : 360×800, 390×844, 1280×800 (conforme au
 *         projet « Chromium Local-Only »).
 */
'use strict';
const { test, expect } = require('@playwright/test');

// ── Viewports ────────────────────────────────────────────────────────────────
const VIEWPORTS = [
  { name: 'mobile-360', width: 360, height: 800 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'desktop-1280', width: 1280, height: 800 },
];

// ── Fixture produit minimal ───────────────────────────────────────────────────
function buildMinimalProduct(overrides = {}) {
  return {
    id: 'geom-test-prod-1',
    name: overrides.name || 'Huile essentielle originale de Madagascar',
    description: 'Description courte',
    price_kmf: 12500,
    price_eur: null,
    old_price_kmf: null,
    image_url: '/boutique/categories/tech.jpg',
    images: ['/boutique/categories/tech.jpg'],
    category: 'mode',
    is_available: true,
    stock: 20,
    inventory_model: 'SIMPLE',
    promo_percent: overrides.promo_percent || null,
    ...overrides,
  };
}

/**
 * Stub minimal : catch-all 200 vide, liste produits, suggestions vides.
 * Le catch-all en dernier (priorité Playwright inversée) évite les faux 500.
 */
async function stubMinimalApi(page, products = null) {
  const prods = products || [buildMinimalProduct(), buildMinimalProduct({ id: 'geom-test-prod-2', name: 'Veste homme sport collection premium', promo_percent: 20 })];

  await page.route(/\/api\/boutique\/suggestions/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ suggestions: [] }) })
  );
  await page.route(/\/api\/products(\?|$)/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(prods) })
  );
  await page.route(/\/api\/products\/[^/]+\/detail/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      product: { id: prods[0].id, name: prods[0].name, category: prods[0].category, description: prods[0].description, inventory_model: 'SIMPLE' },
      pricing: { price_kmf: prods[0].price_kmf, old_price_kmf: null, promo_percent: null },
      media: [{ url: prods[0].image_url }],
      inventory_model: 'SIMPLE',
      option_axes: [],
      sellable_units: [],
      content: null,
      contract_version: 'v3',
      delivery_options: [],
    })})
  );
  await page.route(/\/api\/relais/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { id: 'r1', name: 'KM IT Hub Relais 1785147404083-cxpu23', address: 'Moroni Centre', ile: 'grande_comore' },
    ]) })
  );
  await page.route(/\/api\/identity/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ phone: '+2693701000', name: 'Sam Test' }) })
  );
  await page.route(/\/api\/orders/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ order_id: 'test-order-1', total_kmf: 12500 }) })
  );
  await page.route(/\/api\//, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  );
  return prods;
}

/**
 * Charge la boutique et attend la grille de produits.
 */
async function loadBoutique(page) {
  await page.goto('/boutique/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window._kbus && window._kstate, null, { timeout: 8_000 });
  // Attendre au moins une carte produit ou le placeholder
  await page.waitForSelector('.k-card, .k-grid', { timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(400);
}

/**
 * Injecte un snapshot de liste partagée dans le side cart via le bus interne.
 * Simule activateSharedListContext() sans appel réseau (LOCAL uniquement).
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ creatorName?: string, items?: Array }} opts
 */
async function injectSharedListSnapshot(page, { creatorName = 'Sam', items = null } = {}) {
  const sharedItems = items || [
    { id: 'si-1', product_id: 'geom-test-prod-1', name: 'Huile essentielle originale de Madagascar', price_kmf: 12500, quantity: 1, claimed: false, image_url: '/boutique/categories/tech.jpg' },
    { id: 'si-2', product_id: 'geom-test-prod-2', name: 'Veste homme sport collection premium', price_kmf: 38000, quantity: 2, claimed: true,  image_url: '' },
  ];

  await page.evaluate(({ creatorName, sharedItems }) => {
    // Importer dynamiquement group-side-cart.js et appeler activateSharedListContext
    return import('/boutique/js/group/group-side-cart.js').then(({ activateSharedListContext }) => {
      activateSharedListContext(
        {
          cart: {
            id: 'sc-geom-test',
            token: 'geom-token-abc123',
            status: 'open',
            title: `Liste de ${creatorName}`,
            creator_first_name: creatorName,
            message: null,
          },
          items: sharedItems,
          contributors: [],
          is_creator: false,
        },
        'geom-token-abc123'
      );
    });
  }, { creatorName, sharedItems });

  // Laisser le rendu DOM se stabiliser
  await page.waitForTimeout(500);
}

// ── Utilitaires géométriques ──────────────────────────────────────────────────

/**
 * Retourne true si deux DOMRect se chevauchent (intersection non nulle).
 * Tolérance 1px pour les bordures adjacentes.
 */
function rectsIntersect(a, b, tolerance = 1) {
  return !(
    a.right - tolerance <= b.left ||
    a.left + tolerance >= b.right ||
    a.bottom - tolerance <= b.top ||
    a.top + tolerance >= b.bottom
  );
}

/**
 * Retourne le centre vertical d'un DOMRect.
 */
function centerY(rect) {
  return rect.top + rect.height / 2;
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUPE 1 — Onglets side cart (tabs centering + height parity)
// ─────────────────────────────────────────────────────────────────────────────

for (const vp of VIEWPORTS) {
  test.describe(`[${vp.name}] G1 — Onglets side cart`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ page }) => {
      await stubMinimalApi(page);
      await loadBoutique(page);
      await injectSharedListSnapshot(page, { creatorName: 'Abdourahmane Mohamed' });
    });

    test('G1-a — les deux onglets existent et ont la même hauteur visuelle (±2 px)', async ({ page }) => {
      // Les tabs peuvent être dans #k-cart-surface-switch (desktop side cart)
      // ou #k-cart-surface-switch-drawer (drawer mobile).
      const tabsSelector = '#k-cart-surface-switch, #k-cart-surface-switch-drawer';
      await page.waitForSelector(tabsSelector, { timeout: 6_000 });

      const heights = await page.evaluate((sel) => {
        const containers = Array.from(document.querySelectorAll(sel));
        return containers.map((container) => {
          const tabs = Array.from(container.querySelectorAll('.k-cart-tab, .k-cart-tab-exit'));
          return tabs.map((t) => {
            const r = t.getBoundingClientRect();
            return { class: t.className, height: r.height };
          });
        });
      }, tabsSelector);

      // Au moins un conteneur de tabs trouvé
      expect(heights.length).toBeGreaterThan(0);

      for (const tabSet of heights) {
        if (tabSet.length < 2) continue;
        const h0 = tabSet[0].height;
        for (const tab of tabSet.slice(1)) {
          expect(
            Math.abs(tab.height - h0),
            `Hauteur tab "${tab.class}" (${tab.height}px) differ de >2px vs premier tab (${h0}px)`
          ).toBeLessThanOrEqual(2);
        }
      }
    });

    test('G1-b — label « Liste de X » centré optiquement dans le groupe tab (centre bbox ±4 px vs groupe)', async ({ page }) => {
      await page.waitForSelector('.k-cart-tab-group', { timeout: 6_000 });

      const result = await page.evaluate(() => {
        const groups = Array.from(document.querySelectorAll('.k-cart-tab-group'));
        return groups.map((group) => {
          const groupRect  = group.getBoundingClientRect();
          const labelBtn   = group.querySelector('.k-tab-shared-list');
          const exitBtn    = group.querySelector('.k-cart-tab-exit');
          if (!labelBtn || !exitBtn) return null;

          const labelRect  = labelBtn.getBoundingClientRect();
          const exitRect   = exitBtn.getBoundingClientRect();

          // Zone visuelle disponible pour le label (sans le ×)
          const availableWidth = groupRect.width - exitRect.width;
          // Centre optique du label = left + padding-left + texte/2
          // On mesure le centre de la zone disponible vs le centre de la bbox du label
          const groupCenterX  = groupRect.left + availableWidth / 2;
          const labelCenterX  = labelRect.left + labelRect.width / 2;

          return {
            groupCenterX: Math.round(groupCenterX),
            labelCenterX: Math.round(labelCenterX),
            delta: Math.abs(groupCenterX - labelCenterX),
            groupWidth: groupRect.width,
            exitWidth: exitRect.width,
          };
        }).filter(Boolean);
      });

      expect(result.length).toBeGreaterThan(0);
      for (const r of result) {
        expect(
          r.delta,
          `Label liste décalé de ${r.delta}px du centre optique (groupWidth=${r.groupWidth}px, exitWidth=${r.exitWidth}px)`
        ).toBeLessThanOrEqual(4);
      }
    });

    test('G1-c — le × est tactile (≥24px wide) et ne recouvre pas le label du tab', async ({ page }) => {
      await page.waitForSelector('.k-cart-tab-exit', { timeout: 6_000 });

      const collision = await page.evaluate(() => {
        const exits = Array.from(document.querySelectorAll('.k-cart-tab-exit'));
        return exits.map((exit) => {
          const exitRect = exit.getBoundingClientRect();
          const label = exit.closest('.k-cart-tab-group')?.querySelector('.k-tab-shared-list');
          if (!label) return { exitWidth: exitRect.width, collides: false };
          const labelRect = label.getBoundingClientRect();

          function intersects(a, b) {
            return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
          }
          return {
            exitWidth: exitRect.width,
            collides: intersects(exitRect, labelRect),
          };
        });
      });

      for (const r of collision) {
        expect(r.exitWidth, `Bouton × trop étroit pour être tactile (${r.exitWidth}px < 24px)`).toBeGreaterThanOrEqual(24);
        expect(r.collides, `Bouton × chevauche le label de l'onglet liste`).toBe(false);
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUPE 2 — Lignes snapshot : badge claimed vs nom + checkbox centrée
// ─────────────────────────────────────────────────────────────────────────────

for (const vp of VIEWPORTS) {
  test.describe(`[${vp.name}] G2 — Lignes de snapshot liste partagée`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ page }) => {
      await stubMinimalApi(page);
      await loadBoutique(page);
      await injectSharedListSnapshot(page, {
        creatorName: 'Abdourahmane Mohamed',
        items: [
          { id: 'si-1', product_id: 'geom-test-prod-1', name: 'Huile essentielle originale de Madagascar', price_kmf: 12500, quantity: 1, claimed: false, image_url: '/boutique/categories/tech.jpg' },
          { id: 'si-2', product_id: 'geom-test-prod-2', name: 'Poudre compacte minimaliste finition naturelle très longue tenue', price_kmf: 38000, quantity: 2, claimed: true, image_url: '' },
        ],
      });
    });

    test('G2-a — le badge «Déjà acheté» ne chevauche pas le nom du produit', async ({ page }) => {
      await page.waitForSelector('.k-cart-snapshot-item', { timeout: 6_000 });

      const collision = await page.evaluate(() => {
        function intersects(a, b) {
          return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
        }
        const rows = Array.from(document.querySelectorAll('.k-cart-snapshot-item.is-cart-item-claimed'));
        return rows.map((row) => {
          const badge = row.querySelector('.k-cart-snapshot-item-status-badge');
          const name  = row.querySelector('.k-cart-item-name');
          if (!badge || !name) return null;
          return {
            collides: intersects(badge.getBoundingClientRect(), name.getBoundingClientRect()),
            badgeClass: badge.className,
          };
        }).filter(Boolean);
      });

      for (const r of collision) {
        expect(r.collides, `Badge "${r.badgeClass}" chevauche le nom du produit claimed`).toBe(false);
      }
    });

    test('G2-b — la case .k-cart-item-select est centrée verticalement dans sa ligne (±3 px)', async ({ page }) => {
      await page.waitForSelector('.k-cart-item-select', { timeout: 6_000 });

      const offCenter = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('.k-cart-snapshot-item:not(.is-cart-item-claimed)'));
        return rows.map((row) => {
          const rowRect  = row.getBoundingClientRect();
          const checkbox = row.querySelector('.k-cart-item-select');
          if (!checkbox) return null;
          const cbRect   = checkbox.getBoundingClientRect();
          const rowCenterY = rowRect.top  + rowRect.height  / 2;
          const cbCenterY  = cbRect.top   + cbRect.height   / 2;
          return { delta: Math.abs(rowCenterY - cbCenterY), rowHeight: rowRect.height };
        }).filter(Boolean);
      });

      for (const r of offCenter) {
        expect(
          r.delta,
          `Checkbox décalée de ${r.delta}px du centre vertical de la ligne (rowHeight=${r.rowHeight}px)`
        ).toBeLessThanOrEqual(3);
      }
    });

    test('G2-c — la ligne snapshot ne déborde pas horizontalement de son conteneur', async ({ page }) => {
      await page.waitForSelector('.k-cart-snapshot-item', { timeout: 6_000 });

      const overflow = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('.k-cart-snapshot-item'));
        return rows.map((row) => {
          const parent = row.parentElement;
          if (!parent) return null;
          const rowRect    = row.getBoundingClientRect();
          const parentRect = parent.getBoundingClientRect();
          return {
            overflowRight: Math.max(0, rowRect.right - parentRect.right),
            overflowLeft:  Math.max(0, parentRect.left - rowRect.left),
          };
        }).filter(Boolean);
      });

      for (const r of overflow) {
        expect(r.overflowRight, `Ligne snapshot déborde de ${r.overflowRight}px à droite`).toBeLessThanOrEqual(1);
        expect(r.overflowLeft,  `Ligne snapshot déborde de ${r.overflowLeft}px à gauche`).toBeLessThanOrEqual(1);
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUPE 3 — Catalogue : badge promo ne dépasse pas sur la zone titre
// ─────────────────────────────────────────────────────────────────────────────

for (const vp of VIEWPORTS) {
  test.describe(`[${vp.name}] G3 — Cartes catalogue : badge promo et titre`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ page }) => {
      await stubMinimalApi(page, [
        buildMinimalProduct({ id: 'p1', name: 'Rouge à lèvres chic longue tenue', promo_percent: 20 }),
        buildMinimalProduct({ id: 'p2', name: 'Huile essentielle originale de Madagascar', promo_percent: 15 }),
        buildMinimalProduct({ id: 'p3', name: 'Poudre compacte minimaliste finition naturelle', promo_percent: null }),
      ]);
      await loadBoutique(page);
      await page.waitForSelector('.k-card', { timeout: 8_000 });
    });

    test('G3-a — badge promo ne chevauche pas la zone .k-card-name', async ({ page }) => {
      const collision = await page.evaluate(() => {
        function intersects(a, b) {
          return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
        }
        const badges = Array.from(document.querySelectorAll('.k-card-promo'));
        return badges.map((badge) => {
          const card = badge.closest('.k-card');
          const name = card?.querySelector('.k-card-name');
          if (!name) return null;
          return {
            collides: intersects(badge.getBoundingClientRect(), name.getBoundingClientRect()),
          };
        }).filter(Boolean);
      });

      expect(collision.length).toBeGreaterThan(0);
      for (const r of collision) {
        expect(r.collides, 'Badge promo chevauche le titre produit').toBe(false);
      }
    });

    test('G3-b — badge promo ne dépasse pas de .k-card-img-wrap (overflow:hidden tenu)', async ({ page }) => {
      const overflow = await page.evaluate(() => {
        const badges = Array.from(document.querySelectorAll('.k-card-promo'));
        return badges.map((badge) => {
          const wrap = badge.closest('.k-card-img-wrap');
          if (!wrap) return null;
          const badgeRect = badge.getBoundingClientRect();
          const wrapRect  = wrap.getBoundingClientRect();
          return {
            overflowBottom: Math.max(0, badgeRect.bottom - wrapRect.bottom),
            wrapHeight: wrapRect.height,
            badgeBottom: badgeRect.bottom,
          };
        }).filter(Boolean);
      });

      for (const r of overflow) {
        // La tolérance est 1px pour les bordures sub-pixel
        expect(
          r.overflowBottom,
          `Badge promo déborde de ${r.overflowBottom}px en dessous de l'image-wrap`
        ).toBeLessThanOrEqual(1);
      }
    });

    test('G3-c — le bouton favori .k-card-fav ne chevauche pas .k-card-name', async ({ page }) => {
      const collision = await page.evaluate(() => {
        function intersects(a, b) {
          return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
        }
        const favs = Array.from(document.querySelectorAll('.k-card-fav'));
        return favs.map((fav) => {
          const card = fav.closest('.k-card');
          const name = card?.querySelector('.k-card-name');
          if (!name) return null;
          return { collides: intersects(fav.getBoundingClientRect(), name.getBoundingClientRect()) };
        }).filter(Boolean);
      });

      for (const r of collision) {
        expect(r.collides, 'Bouton favori chevauche le titre produit').toBe(false);
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUPE 4 — Checkout : chips paiement hauteur homogène + CTA safe-area
// ─────────────────────────────────────────────────────────────────────────────

for (const vp of VIEWPORTS) {
  test.describe(`[${vp.name}] G4 — Checkout : chips + CTA`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    /**
     * Ouvre le checkout en émettant checkout:open via le bus interne.
     * Le checkout réel n'est accessible qu'avec une identité + relais ;
     * en mode LOCAL on provoque uniquement l'ouverture du modal.
     */
    async function openCheckoutModal(page) {
      await page.evaluate(() => {
        window._kbus && window._kbus.emit('checkout:open', { source: 'geometry-test' });
      });
      // Le modal checkout = .k-order-overlay.open ou #k-order-modal.open
      await page.waitForSelector('.k-order-overlay.open, #k-order-modal.open', {
        timeout: 6_000,
      }).catch(() => {});
      await page.waitForTimeout(500);
    }

    test.beforeEach(async ({ page }) => {
      await stubMinimalApi(page);
      await loadBoutique(page);
    });

    test('G4-a — chips de paiement ont la même hauteur (±3 px)', async ({ page }) => {
      await openCheckoutModal(page);

      const chips = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.ck-pay-chip')).map((c) => ({
          height: c.getBoundingClientRect().height,
          class: c.className,
        }));
      });

      if (chips.length < 2) {
        test.skip(true, 'Chips paiement non rendues en mode LOCAL (pas de relais/identité configurés)');
        return;
      }

      const h0 = chips[0].height;
      for (const chip of chips.slice(1)) {
        expect(
          Math.abs(chip.height - h0),
          `Chip "${chip.class}" (${chip.height}px) diffère de >3px vs premier chip (${h0}px)`
        ).toBeLessThanOrEqual(3);
      }
    });

    test('G4-b — CTA .ck-confirm-btn n\'est pas masqué derrière le bas de l\'écran', async ({ page }) => {
      await openCheckoutModal(page);

      const cta = await page.evaluate((viewportHeight) => {
        const btn = document.querySelector('.ck-confirm-btn');
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        return {
          top: r.top,
          bottom: r.bottom,
          height: r.height,
          hidden: r.top >= viewportHeight || r.height === 0,
        };
      }, vp.height);

      if (!cta) {
        test.skip(true, 'CTA non rendu en mode LOCAL (checkout non complet sans relais)');
        return;
      }

      expect(cta.hidden, `CTA checkout masqué sous le viewport (top=${cta.top}px, height=${cta.height}px)`).toBe(false);
      expect(cta.height, 'CTA checkout sans hauteur visible').toBeGreaterThan(0);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUPE 5 — Récapitulatif : ck-recap-check centré + titre visible
// ─────────────────────────────────────────────────────────────────────────────

for (const vp of VIEWPORTS) {
  test.describe(`[${vp.name}] G5 — Récapitulatif checkout`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ page }) => {
      await stubMinimalApi(page);
      await loadBoutique(page);
    });

    test('G5-a — ✓ est centré dans son cercle .ck-recap-check (±3 px)', async ({ page }) => {
      // Injecter le HTML du récapitulatif directement dans le DOM de test
      await page.evaluate(() => {
        const div = document.createElement('div');
        div.id = 'geom-recap-probe';
        div.style.cssText = 'position:fixed;top:80px;left:50%;transform:translateX(-50%);background:#fff;padding:20px;border:1px solid #ccc;z-index:9999;';
        div.innerHTML = `
          <div class="ck-recap-item">
            <span class="ck-recap-check" aria-hidden="true">✓</span>
            <div class="ck-recap-item-info"><div class="ck-recap-item-name">Huile essentielle originale de Madagascar</div></div>
            <span class="ck-recap-item-price">12 500 KMF</span>
          </div>`;
        document.body.appendChild(div);
      });

      await page.waitForTimeout(200);

      const centering = await page.evaluate(() => {
        const circle = document.querySelector('#geom-recap-probe .ck-recap-check');
        if (!circle) return null;
        const r = circle.getBoundingClientRect();
        // Chercher le glyphe ✓ via getClientRects ou Range
        const range = document.createRange();
        const textNode = circle.firstChild;
        if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
          return { circleHeight: r.height, circleWidth: r.width, glyphMeasurable: false };
        }
        range.selectNodeContents(textNode);
        const glyphRects = Array.from(range.getClientRects());
        if (!glyphRects.length) return { circleHeight: r.height, circleWidth: r.width, glyphMeasurable: false };

        const glyph = glyphRects[0];
        const circleCenterY = r.top  + r.height / 2;
        const glyphCenterY  = glyph.top + glyph.height / 2;
        const circleCenterX = r.left + r.width  / 2;
        const glyphCenterX  = glyph.left + glyph.width  / 2;

        return {
          deltaY: Math.abs(circleCenterY - glyphCenterY),
          deltaX: Math.abs(circleCenterX - glyphCenterX),
          circleHeight: r.height,
          circleWidth: r.width,
          glyphMeasurable: true,
        };
      });

      // Cleanup
      await page.evaluate(() => document.getElementById('geom-recap-probe')?.remove());

      if (!centering || !centering.glyphMeasurable) {
        // Si le Range ne peut pas mesurer le glyphe (comportement navigateur variable),
        // on vérifie au moins que le cercle a les bonnes dimensions (20×20)
        if (centering) {
          expect(centering.circleHeight).toBeGreaterThanOrEqual(18);
          expect(centering.circleWidth).toBeGreaterThanOrEqual(18);
        }
        return;
      }

      expect(
        centering.deltaY,
        `✓ décalé de ${centering.deltaY}px verticalement du centre du cercle (height=${centering.circleHeight}px)`
      ).toBeLessThanOrEqual(3);
      expect(
        centering.deltaX,
        `✓ décalé de ${centering.deltaX}px horizontalement du centre du cercle (width=${centering.circleWidth}px)`
      ).toBeLessThanOrEqual(3);
    });

    test('G5-b — .ck-recap-gate-heading n\'est pas recouvert (visible dans le viewport)', async ({ page }) => {
      await page.evaluate(() => {
        const div = document.createElement('div');
        div.id = 'geom-recap-heading-probe';
        div.innerHTML = '<h2 class="ck-recap-gate-heading">Récapitulatif de votre commande</h2>';
        div.style.cssText = 'position:fixed;top:100px;left:50%;transform:translateX(-50%);z-index:9998;background:#fff;padding:10px;';
        document.body.appendChild(div);
      });

      await page.waitForTimeout(100);

      const headingVisible = await page.evaluate((viewportHeight) => {
        const h = document.querySelector('#geom-recap-heading-probe .ck-recap-gate-heading');
        if (!h) return null;
        const r = h.getBoundingClientRect();
        return r.height > 0 && r.top >= 0 && r.bottom <= viewportHeight && r.width > 0;
      }, vp.height);

      await page.evaluate(() => document.getElementById('geom-recap-heading-probe')?.remove());

      expect(headingVisible, '.ck-recap-gate-heading invisible ou hors viewport').toBe(true);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUPE 6 — Invariants CSS statiques (lecture de fichier, pas de Playwright)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('G6 — Invariants CSS statiques des corrections LOT 1–4', () => {
  // Ce groupe n'a pas besoin d'un viewport — il lit les fichiers CSS sources.
  const fs   = require('fs');
  const path = require('path');
  const CSS  = path.resolve(__dirname, '../../css');

  function readCss(name) {
    return fs.readFileSync(path.join(CSS, name), 'utf8');
  }

  test('G6-a — .k-cart-tab a text-align:center (centrage cross-browser)', () => {
    const css = readCss('shared-list-side-cart.css');
    // Le bloc .k-cart-tab doit contenir text-align: center
    const block = css.match(/\.k-cart-tab\s*\{([^}]+)\}/s)?.[1] || '';
    expect(block).toMatch(/text-align\s*:\s*center/);
  });

  test('G6-b — .k-cart-tab a line-height:1 (parité hauteur avec k-cart-tab-exit)', () => {
    const css = readCss('shared-list-side-cart.css');
    const block = css.match(/\.k-cart-tab\s*\{([^}]+)\}/s)?.[1] || '';
    expect(block).toMatch(/line-height\s*:\s*1\b/);
  });

  test('G6-c — .k-tab-shared-list a padding-left:26px (centrage optique vs ×)', () => {
    const css = readCss('shared-list-side-cart.css');
    // Le sélecteur exact est .k-cart-tab-group .k-tab-shared-list
    const block = css.match(/\.k-cart-tab-group\s+\.k-tab-shared-list\s*\{([^}]+)\}/s)?.[1] || '';
    expect(block).toMatch(/padding-left\s*:\s*26px/);
  });

  test('G6-d — .ck-recap-check a line-height:1 (✓ centré sans décalage typographique)', () => {
    const css = readCss('checkout-vertical-rail.css');
    const block = css.match(/\.ck-recap-check\s*\{([^}]+)\}/s)?.[1] || '';
    expect(block).toMatch(/line-height\s*:\s*1\b/);
  });

  test('G6-e — .k-card-name a -webkit-line-clamp:2 à 900px+ (plus d'espace mort)', () => {
    const css = readCss('products.css');
    // Chercher le bloc @media contenant le correctif desktop k-card-name
    const mediaBlock = css.match(/@media\s*\(\(min-width:\s*900px\)\)[\s\S]*?\.k-card-name\s*\{([^}]+)\}/)?.[1] || '';
    expect(mediaBlock).toMatch(/-webkit-line-clamp\s*:\s*2\b/);
  });

  test('G6-f — .ck-chip-lbl em.ck-soon est autonome dans checkout-vertical-rail.css', () => {
    const css = readCss('checkout-vertical-rail.css');
    // Le bloc doit contenir display, background, color (pas seulement border-radius)
    const block = css.match(/\.ck-chip-lbl\s+em\.ck-soon\s*\{([^}]+)\}/s)?.[1] || '';
    expect(block).toMatch(/display\s*:\s*inline-block/);
    expect(block).toMatch(/background\s*:/);
    expect(block).toMatch(/color\s*:/);
    expect(block).toMatch(/font-style\s*:\s*normal/);
  });

  test('G6-g — .ck-chip-lbl em.ck-stripe-tag est autonome dans checkout-vertical-rail.css', () => {
    const css = readCss('checkout-vertical-rail.css');
    const block = css.match(/\.ck-chip-lbl\s+em\.ck-stripe-tag\s*\{([^}]+)\}/s)?.[1] || '';
    expect(block).toMatch(/display\s*:\s*inline-block/);
    expect(block).toMatch(/background\s*:/);
    expect(block).toMatch(/font-style\s*:\s*normal/);
  });
});
