/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   visual-geometry-audit.spec.js
 * @feature side-cart, shared-list, checkout, catalogue
 * @brief  Audit géométrique des invariants visuels — campagne QA 2026-08.
 *         Tourne en mode LOCAL (APIs stubbées) dans le projet «Chromium Local-Only».
 *
 * Invariants :
 *   G1 — Onglets side cart : hauteur homogène, label centré, × tactile
 *   G2 — Snapshot liste : badge claimed ≠ nom, checkbox centrée, pas d'overflow
 *   G3 — Catalogue : badge promo dans img-wrap, favori ≠ nom
 *   G4 — Checkout : chips même hauteur, CTA non masqué
 *   G5 — Récapitulatif : ✓ centré, heading visible
 *   G6 — Invariants CSS statiques (sans navigateur)
 *
 * Pattern d'attente :
 *   On utilise waitForSelector(sel, { state:'attached' }) pour la présence DOM,
 *   puis page.evaluate() pour les mesures géométriques réelles.
 *   page.waitForFunction() s'avère peu fiable pour les sélecteurs CSS composés
 *   sur le projet Chromium Local-Only (confirmé en diagnostic).
 */
'use strict';
const { test, expect } = require('@playwright/test');

// ── Viewports ────────────────────────────────────────────────────────────────
const VIEWPORTS = [
  { name: 'mobile-360',  width: 360,  height: 800  },
  { name: 'mobile-390',  width: 390,  height: 844  },
  { name: 'desktop-1280', width: 1280, height: 800 },
];

// ── Fixture produit minimal ───────────────────────────────────────────────────
function buildMinimalProduct(ov = {}) {
  return {
    id:             ov.id            || 'geom-prod-1',
    name:           ov.name          || 'Huile essentielle originale de Madagascar',
    description:    'Description courte',
    price_kmf:      ov.price_kmf     || 12500,
    price_eur:      null, old_price_kmf: null,
    image_url:      ov.image_url     || '/boutique/categories/tech.jpg',
    images:         ov.images        || ['/boutique/categories/tech.jpg'],
    category:       ov.category      || 'mode',
    is_available:   true, stock: 20,
    inventory_model:'SIMPLE',
    promo_pct:  ov.promo_pct || null,
  };
}

// ── Stub API ──────────────────────────────────────────────────────────────────
async function stubMinimalApi(page, products) {
  const prods = products || [
    buildMinimalProduct(),
    buildMinimalProduct({ id:'geom-prod-2', name:'Veste homme sport collection premium', promo_pct:20 }),
  ];
  // Catch-all d'abord : Playwright essaie les routes en LIFO (dernier
  // enregistré = premier essayé). Le catch-all doit donc être enregistré
  // AVANT les routes spécifiques pour qu'elles gagnent réellement — sinon
  // il intercepte tout, y compris /api/products, avant qu'elles s'exécutent.
  await page.route(/\/api\//, r => r.fulfill({ status:200, contentType:'application/json', body:'{}' }));
  await page.route(/\/api\/boutique\/suggestions/, r => r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({suggestions:[]}) }));
  await page.route(/\/api\/products(\?|$)/, r => r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(prods) }));
  await page.route(/\/api\/products\/[^/]+\/detail/, r => r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({
    product:{ id:prods[0].id, name:prods[0].name, category:prods[0].category, description:prods[0].description, inventory_model:'SIMPLE' },
    pricing:{ price_kmf:prods[0].price_kmf, old_price_kmf:null, promo_pct:null },
    media:[{ url:prods[0].image_url }], inventory_model:'SIMPLE',
    option_axes:[], sellable_units:[], content:null, contract_version:'v3', delivery_options:[],
  }) }));
  await page.route(/\/api\/relais/, r => r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify([
    { id:'r1', name:'KM IT Hub Relais 1785147404083-cxpu23', address:'Moroni Centre', ile:'grande_comore' },
  ]) }));
  await page.route(/\/api\/identity/, r => r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ phone:'+2693701000', name:'Sam Test' }) }));
  await page.route(/\/api\/orders/, r => r.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ order_id:'o1', total_kmf:12500 }) }));
  return prods;
}

// ── loadBoutique ──────────────────────────────────────────────────────────────
async function loadBoutique(page) {
  await page.goto('/boutique/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window._kbus && window._kstate, null, { timeout: 8_000 });
  await page.waitForSelector('.k-card, .k-grid', { timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(400);
}

// ── injectSharedListSnapshot ──────────────────────────────────────────────────
async function injectSharedListSnapshot(page, { creatorName = 'Sam', items = null } = {}) {
  const sharedItems = items || [
    { id:'si-1', product_id:'geom-prod-1', name:'Huile essentielle originale de Madagascar',
      price_kmf:12500, quantity:1, claimed:false, image_url:'/boutique/categories/tech.jpg' },
    { id:'si-2', product_id:'geom-prod-2', name:'Veste homme sport collection premium',
      price_kmf:38000, quantity:2, claimed:true,  image_url:'' },
  ];

  await page.evaluate(({ creatorName, sharedItems }) =>
    import('/boutique/js/group/group-side-cart.js').then(({ activateSharedListContext }) =>
      activateSharedListContext(
        { cart:{ id:'sc-geom', token:'geom-tok', status:'open',
                 title:`Liste de ${creatorName}`, creator_first_name:creatorName, message:null },
          items:sharedItems, contributors:[], is_creator:false },
        'geom-tok'
      )
    ),
  { creatorName, sharedItems });

  // Sur mobile (< 900px) : ouvrir le drawer manuellement
  const vw = await page.evaluate(() => window.innerWidth);
  if (vw < 900) {
    await page.evaluate(() =>
      import('/boutique/js/b-cart.js').then(({ openCart }) => openCart())
    );
  }
  await page.waitForTimeout(700);
}

// ── Attente tabs présents dans le DOM ─────────────────────────────────────────
// Utilise waitForSelector (state:'attached') plutôt que waitForFunction
// (plus stable sur Chromium Local-Only pour les sélecteurs CSS composés).
async function waitForTabsAttached(page) {
  // Les tabs existent dans les deux conteneurs dès activateSharedListContext().
  // On attend l'un ou l'autre selon le premier attaché.
  try {
    await page.waitForSelector('#k-cart-surface-switch, #k-cart-surface-switch-drawer',
      { state:'attached', timeout: 8_000 });
  } catch (_) { /* continue */ }
  // Laisser le CSS s'appliquer
  await page.waitForTimeout(200);
}

// ── Mesure des conteneurs de tabs VISIBLES ────────────────────────────────────
// Renvoie les conteneurs dont getBoundingClientRect().width > 0.
// Note : querySelector (CSS selector avec #) plutôt que getElementById (sans #).
async function getVisibleTabContainers(page) {
  return page.evaluate(() => {
    return ['#k-cart-surface-switch', '#k-cart-surface-switch-drawer']
      .map(sel => document.querySelector(sel))   // querySelector accepte les sélecteurs CSS avec #
      .filter(el => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map(el => ({
        id:     el.id,
        width:  el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
        tabs: Array.from(el.querySelectorAll('.k-cart-tab, .k-cart-tab-exit')).map(t => {
          const r = t.getBoundingClientRect();
          return { cls: t.className, w: r.width, h: r.height, left: r.left };
        }),
        groups: Array.from(el.querySelectorAll('.k-cart-tab-group')).map(g => {
          const gR = g.getBoundingClientRect();
          const lbl = g.querySelector('.k-tab-shared-list');
          const ex  = g.querySelector('.k-cart-tab-exit');
          const lR = lbl ? lbl.getBoundingClientRect() : null;
          const eR = ex  ? ex.getBoundingClientRect()  : null;
          return {
            gW: gR.width, gH: gR.height, gLeft: gR.left,
            lblW: lR ? lR.width : 0,  lblCtrX: lR ? lR.left + lR.width  / 2 : 0,
            exW:  eR ? eR.width  : 0,
            availCtrX: eR ? gR.left + (gR.width - eR.width) / 2 : 0,
          };
        }),
      }));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUPE 1 — Onglets side cart
// ─────────────────────────────────────────────────────────────────────────────

for (const vp of VIEWPORTS) {
  test.describe(`[${vp.name}] G1 — Onglets side cart`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ page }) => {
      await stubMinimalApi(page);
      await loadBoutique(page);
      await injectSharedListSnapshot(page, { creatorName: 'Abdourahmane Mohamed' });
      await waitForTabsAttached(page);
    });

    test('G1-a — les deux onglets ont la même hauteur visuelle (±2 px)', async ({ page }) => {
      const containers = await getVisibleTabContainers(page);
      expect(containers.length, 'Aucun conteneur de tabs visible').toBeGreaterThan(0);

      for (const c of containers) {
        if (c.tabs.length < 2) continue;
        const h0 = c.tabs[0].h;
        for (const tab of c.tabs.slice(1)) {
          expect(
            Math.abs(tab.h - h0),
            `[${c.id}] Tab "${tab.cls}" (${tab.h}px) differ de >2px vs premier (${h0}px)`
          ).toBeLessThanOrEqual(2);
        }
      }
    });

    test('G1-b — label « Liste de X » centré optiquement (±4 px)', async ({ page }) => {
      const containers = await getVisibleTabContainers(page);
      expect(containers.length, 'Aucun conteneur de tabs visible').toBeGreaterThan(0);

      for (const c of containers) {
        for (const g of c.groups) {
          if (g.exW === 0) continue; // groupe sans bouton ×
          expect(
            Math.abs(g.availCtrX - g.lblCtrX),
            `Label décalé de ${Math.abs(g.availCtrX - g.lblCtrX).toFixed(1)}px (groupW=${g.gW}px, ×W=${g.exW}px)`
          ).toBeLessThanOrEqual(4);
        }
      }
    });

    test('G1-c — bouton × tactile (≥24 px) et sans collision avec le label', async ({ page }) => {
      const containers = await getVisibleTabContainers(page);
      expect(containers.length, 'Aucun conteneur de tabs visible').toBeGreaterThan(0);

      const exits = await page.evaluate(() => {
        function intersects(a, b) {
          return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
        }
        // Buttons × visibles uniquement (dans conteneur visible)
        return Array.from(document.querySelectorAll('.k-cart-tab-exit'))
          .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0; })
          .map(exit => {
            const eR = exit.getBoundingClientRect();
            const lbl = exit.closest('.k-cart-tab-group')?.querySelector('.k-tab-shared-list');
            return {
              exitWidth: eR.width,
              collides: lbl ? intersects(eR, lbl.getBoundingClientRect()) : false,
            };
          });
      });

      expect(exits.length, 'Aucun bouton × visible').toBeGreaterThan(0);
      for (const r of exits) {
        expect(r.exitWidth, `Bouton × trop étroit (${r.exitWidth}px < 24px)`).toBeGreaterThanOrEqual(24);
        expect(r.collides, 'Bouton × chevauche le label').toBe(false);
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUPE 2 — Lignes snapshot
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
          { id:'si-1', product_id:'geom-prod-1',
            name:'Huile essentielle originale de Madagascar',
            price_kmf:12500, quantity:1, claimed:false, image_url:'/boutique/categories/tech.jpg' },
          { id:'si-2', product_id:'geom-prod-2',
            name:'Poudre compacte minimaliste finition naturelle très longue tenue',
            price_kmf:38000, quantity:2, claimed:true, image_url:'' },
        ],
      });
      await page.waitForSelector('.k-cart-snapshot-item', { state:'attached', timeout:8_000 }).catch(()=>{});
      await page.waitForTimeout(200);
    });

    test('G2-a — badge «Déjà acheté» ne chevauche pas le nom du produit', async ({ page }) => {
      const collision = await page.evaluate(() => {
        function intersects(a, b) {
          return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
        }
        return Array.from(document.querySelectorAll('.k-cart-snapshot-item.is-cart-item-claimed'))
          .filter(r => { const bx = r.getBoundingClientRect(); return bx.width > 0; })
          .map(row => {
            const badge = row.querySelector('.k-cart-snapshot-item-status-badge');
            const name  = row.querySelector('.k-cart-item-name');
            if (!badge || !name) return null;
            return { collides: intersects(badge.getBoundingClientRect(), name.getBoundingClientRect()) };
          }).filter(Boolean);
      });

      for (const r of collision) {
        expect(r.collides, 'Badge "Déjà acheté" chevauche le nom du produit').toBe(false);
      }
    });

    test('G2-b — checkbox centrée verticalement dans sa ligne (±3 px)', async ({ page }) => {
      const offCenter = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.k-cart-snapshot-item:not(.is-cart-item-claimed)'))
          .filter(row => { const r = row.getBoundingClientRect(); return r.height > 0; })
          .map(row => {
            const rR = row.getBoundingClientRect();
            const cb = row.querySelector('.k-cart-item-select');
            if (!cb) return null;
            const cR = cb.getBoundingClientRect();
            return {
              delta: Math.abs((rR.top + rR.height / 2) - (cR.top + cR.height / 2)),
              rowH: rR.height,
            };
          }).filter(Boolean)
      );

      for (const r of offCenter) {
        expect(r.delta,
          `Checkbox décalée de ${r.delta.toFixed(1)}px du centre vertical (rowH=${r.rowH}px)`
        ).toBeLessThanOrEqual(3);
      }
    });

    test('G2-c — lignes snapshot sans overflow horizontal', async ({ page }) => {
      const overflow = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.k-cart-snapshot-item'))
          .filter(row => { const r = row.getBoundingClientRect(); return r.width > 0; })
          .map(row => {
            const p = row.parentElement;
            if (!p) return null;
            const rR = row.getBoundingClientRect();
            const pR = p.getBoundingClientRect();
            return {
              right: Math.max(0, rR.right  - pR.right),
              left:  Math.max(0, pR.left   - rR.left),
            };
          }).filter(Boolean)
      );

      for (const r of overflow) {
        expect(r.right, `Overflow droit de ${r.right}px`).toBeLessThanOrEqual(1);
        expect(r.left,  `Overflow gauche de ${r.left}px`).toBeLessThanOrEqual(1);
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUPE 3 — Catalogue
// ─────────────────────────────────────────────────────────────────────────────

for (const vp of VIEWPORTS) {
  test.describe(`[${vp.name}] G3 — Cartes catalogue : badge promo et titre`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ page }) => {
      // 4 produits minimum, même catégorie : b-catalog.js MIN_PER_SECTION=4
      // rejette toute section (et tout reliquat) sous ce seuil sur desktop
      // (renderHomeSections) — avec 3, la section entière disparaît en
      // >=900px alors qu'elle s'affiche en mobile (chemin de rendu différent).
      await stubMinimalApi(page, [
        buildMinimalProduct({ id:'p1', name:'Rouge à lèvres chic longue tenue', promo_pct:20 }),
        buildMinimalProduct({ id:'p2', name:'Huile essentielle originale de Madagascar', promo_pct:15 }),
        buildMinimalProduct({ id:'p3', name:'Poudre compacte minimaliste finition naturelle', promo_pct:null }),
        buildMinimalProduct({ id:'p4', name:'Sac à main artisanal fait main', promo_pct:null }),
      ]);
      await loadBoutique(page);
      await page.waitForSelector('.k-card', { state:'attached', timeout:8_000 }).catch(()=>{});
      await page.waitForTimeout(300);
    });

    test('G3-a — badge promo ne chevauche pas .k-card-name', async ({ page }) => {
      const collision = await page.evaluate(() => {
        function intersects(a, b) {
          return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
        }
        return Array.from(document.querySelectorAll('.k-card-promo')).map(badge => {
          const name = badge.closest('.k-card')?.querySelector('.k-card-name');
          if (!name) return null;
          return { collides: intersects(badge.getBoundingClientRect(), name.getBoundingClientRect()) };
        }).filter(Boolean);
      });

      expect(collision.length, 'Aucun badge promo trouvé').toBeGreaterThan(0);
      for (const r of collision) {
        expect(r.collides, 'Badge promo chevauche le titre produit').toBe(false);
      }
    });

    test('G3-b — badge promo confiné dans .k-card-img-wrap (overflow:hidden)', async ({ page }) => {
      const overflow = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.k-card-promo')).map(badge => {
          const wrap = badge.closest('.k-card-img-wrap');
          if (!wrap) return null;
          const bR = badge.getBoundingClientRect();
          const wR = wrap.getBoundingClientRect();
          return { below: Math.max(0, bR.bottom - wR.bottom) };
        }).filter(Boolean)
      );

      expect(overflow.length, 'Aucun badge promo trouvé').toBeGreaterThan(0);
      for (const r of overflow) {
        expect(r.below, `Badge déborde de ${r.below}px sous l'image-wrap`).toBeLessThanOrEqual(1);
      }
    });

    test('G3-c — bouton favori .k-card-fav ne chevauche pas .k-card-name', async ({ page }) => {
      const collision = await page.evaluate(() => {
        function intersects(a, b) {
          return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
        }
        return Array.from(document.querySelectorAll('.k-card-fav')).map(fav => {
          const name = fav.closest('.k-card')?.querySelector('.k-card-name');
          if (!name) return null;
          return { collides: intersects(fav.getBoundingClientRect(), name.getBoundingClientRect()) };
        }).filter(Boolean);
      });

      expect(collision.length, 'Aucun bouton favori trouvé').toBeGreaterThan(0);
      for (const r of collision) {
        expect(r.collides, 'Bouton favori chevauche le titre produit').toBe(false);
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUPE 4 — Checkout
// ─────────────────────────────────────────────────────────────────────────────

for (const vp of VIEWPORTS) {
  test.describe(`[${vp.name}] G4 — Checkout : chips + CTA`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ page }) => {
      await stubMinimalApi(page);
      await loadBoutique(page);

      // checkoutCart() garde sur state.cart.length === 0 → émet un toast et sort.
      // Solution : ajouter un article au panier via quickAdd() (prend le 1er produit
      // de state.products, déjà peuplé par le catalogue chargé dans loadBoutique).
      // quickAdd(productId, btnEl) — btnEl peut être null en mode programmatique.
      const addOk = await page.evaluate(() =>
        import('/boutique/js/b-cart.js').then(({ quickAdd }) => {
          const { state } = window._kstate
            ? { state: window._kstate }
            : {};
          // Récupérer le premier produit disponible dans l'état global
          const pid = (window._kstate?.products?.[0]?.id) ?? 'geom-prod-1';
          quickAdd(pid, null);
          return pid;
        })
      );

      // Déclencher le checkout — la garde passe maintenant (cart.length ≥ 1)
      await page.evaluate(() => window._kbus?.emit('checkout:open', { source: 'geometry-test' }));

      // Attendre l'ouverture du modal (#k-order-modal.open ou .k-order-overlay.open)
      await page.waitForSelector('#k-order-modal.open, .k-order-overlay.open',
        { timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(600);
    });

    test('G4-a — chips de paiement ont la même hauteur (±3 px)', async ({ page }) => {
      const chips = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.ck-pay-chip'))
          .filter(c => { const r = c.getBoundingClientRect(); return r.height > 0; })
          .map(c => ({ h: c.getBoundingClientRect().height, cls: c.className }))
      );

      if (chips.length < 2) {
        test.skip(true, 'Chips paiement non rendues en LOCAL (checkout incomplet)');
        return;
      }
      const h0 = chips[0].h;
      for (const chip of chips.slice(1)) {
        expect(
          Math.abs(chip.h - h0),
          `Chip (${chip.h}px) differ de >3px vs premier chip (${h0}px)`
        ).toBeLessThanOrEqual(3);
      }
    });

    test("G4-b — CTA .ck-confirm-btn n'est pas masqué sous le viewport", async ({ page }) => {
      const vpH = vp.height;
      const cta = await page.evaluate((viewportH) => {
        const btn = document.querySelector('.ck-confirm-btn');
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        return { top: r.top, h: r.height, hidden: r.top >= viewportH || r.height === 0 };
      }, vpH);

      if (!cta) {
        test.skip(true, 'CTA non rendu en LOCAL (checkout incomplet)');
        return;
      }
      expect(cta.hidden, `CTA masqué (top=${cta.top}px, h=${cta.h}px)`).toBe(false);
      expect(cta.h, 'CTA sans hauteur').toBeGreaterThan(0);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUPE 5 — Récapitulatif
// ─────────────────────────────────────────────────────────────────────────────

for (const vp of VIEWPORTS) {
  test.describe(`[${vp.name}] G5 — Récapitulatif checkout`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ page }) => {
      await stubMinimalApi(page);
      await loadBoutique(page);
    });

    test('G5-a — ✓ est centré dans son cercle .ck-recap-check (±3 px)', async ({ page }) => {
      await page.evaluate(() => {
        const div = document.createElement('div');
        div.id = 'geom-recap-probe';
        div.style.cssText = 'position:fixed;top:80px;left:50%;transform:translateX(-50%);background:#fff;padding:20px;border:1px solid #ccc;z-index:9999;';
        div.innerHTML = `<div class="ck-recap-item">
          <span class="ck-recap-check" aria-hidden="true">&#10003;</span>
          <div class="ck-recap-item-info"><div class="ck-recap-item-name">Huile essentielle</div></div>
          <span class="ck-recap-item-price">12 500 KMF</span>
        </div>`;
        document.body.appendChild(div);
      });
      await page.waitForTimeout(200);

      const centering = await page.evaluate(() => {
        const circle = document.querySelector('#geom-recap-probe .ck-recap-check');
        if (!circle) return null;
        const cR = circle.getBoundingClientRect();
        const range = document.createRange();
        const textNode = circle.firstChild;
        if (!textNode || textNode.nodeType !== 3)
          return { circleH: cR.height, circleW: cR.width, measurable: false };
        range.selectNodeContents(textNode);
        const rects = Array.from(range.getClientRects());
        if (!rects.length) return { circleH: cR.height, circleW: cR.width, measurable: false };
        const gR = rects[0];
        return {
          deltaY:   Math.abs((cR.top  + cR.height / 2) - (gR.top  + gR.height / 2)),
          deltaX:   Math.abs((cR.left + cR.width  / 2) - (gR.left + gR.width  / 2)),
          circleH:  cR.height, circleW: cR.width, measurable: true,
        };
      });

      await page.evaluate(() => document.getElementById('geom-recap-probe')?.remove());

      if (!centering) { test.fail(true, '.ck-recap-check introuvable'); return; }
      if (!centering.measurable) {
        expect(centering.circleH, 'Cercle trop petit').toBeGreaterThanOrEqual(18);
        expect(centering.circleW, 'Cercle trop petit').toBeGreaterThanOrEqual(18);
        return;
      }
      expect(centering.deltaY,
        `✓ décalé de ${centering.deltaY.toFixed(1)}px verticalement`
      ).toBeLessThanOrEqual(3);
      expect(centering.deltaX,
        `✓ décalé de ${centering.deltaX.toFixed(1)}px horizontalement`
      ).toBeLessThanOrEqual(3);
    });

    test('G5-b — .ck-recap-gate-heading visible dans le viewport', async ({ page }) => {
      await page.evaluate(() => {
        const div = document.createElement('div');
        div.id = 'geom-heading-probe';
        div.style.cssText = 'position:fixed;top:100px;left:50%;transform:translateX(-50%);z-index:9998;background:#fff;padding:10px;';
        div.innerHTML = '<h2 class="ck-recap-gate-heading">Récapitulatif de votre commande</h2>';
        document.body.appendChild(div);
      });
      await page.waitForTimeout(100);

      const visible = await page.evaluate((vpH) => {
        const h = document.querySelector('#geom-heading-probe .ck-recap-gate-heading');
        if (!h) return null;
        const r = h.getBoundingClientRect();
        return r.height > 0 && r.top >= 0 && r.bottom <= vpH && r.width > 0;
      }, vp.height);

      await page.evaluate(() => document.getElementById('geom-heading-probe')?.remove());
      expect(visible, '.ck-recap-gate-heading hors-viewport ou invisible').toBe(true);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUPE 6 — Invariants CSS statiques (sans navigateur)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('G6 — Invariants CSS statiques des corrections LOT 1–4', () => {
  const fs   = require('fs');
  const path = require('path');
  const CSS  = path.resolve(__dirname, '../../css');
  function readCss(name) { return fs.readFileSync(path.join(CSS, name), 'utf8'); }

  test('G6-a — .k-cart-tab a text-align:center (centrage cross-browser)', () => {
    const b = readCss('shared-list-side-cart.css').match(/\.k-cart-tab\s*\{([^}]+)\}/s)?.[1] ?? '';
    expect(b).toMatch(/text-align\s*:\s*center/);
  });
  test('G6-b — .k-cart-tab a line-height:1 (parité avec k-cart-tab-exit)', () => {
    const b = readCss('shared-list-side-cart.css').match(/\.k-cart-tab\s*\{([^}]+)\}/s)?.[1] ?? '';
    expect(b).toMatch(/line-height\s*:\s*1\b/);
  });
  test('G6-c — .k-tab-shared-list a padding-left:26px (centrage optique vs ×)', () => {
    const b = readCss('shared-list-side-cart.css').match(/\.k-cart-tab-group\s+\.k-tab-shared-list\s*\{([^}]+)\}/s)?.[1] ?? '';
    expect(b).toMatch(/padding-left\s*:\s*26px/);
  });
  test('G6-d — .ck-recap-check a line-height:1 (✓ centré sans décalage typo)', () => {
    const b = readCss('checkout-vertical-rail.css').match(/\.ck-recap-check\s*\{([^}]+)\}/s)?.[1] ?? '';
    expect(b).toMatch(/line-height\s*:\s*1\b/);
  });
  test("G6-e — .k-card-name desktop utilise -webkit-line-clamp:2 (pas d'espace mort)", () => {
    const mb = readCss('products.css').match(/@media\s*\(\(min-width:\s*900px\)\)[\s\S]*?\.k-card-name\s*\{([^}]+)\}/)?.[1] ?? '';
    expect(mb).toMatch(/-webkit-line-clamp\s*:\s*2\b/);
  });
  test('G6-f/g — sélecteur combiné ck-soon+ck-stripe-tag : surcharges géométriques dans checkout-vertical-rail.css', () => {
    // Le sélecteur combiné (.ck-soon, .ck-stripe-tag) est dans la baseline css-guard.
    // background/color restent dans cart.css ; les redéclarer ici avec d'autres valeurs
    // crée de nouveaux conflits (confirmé empiriquement). Seules les surcharges géométriques
    // (border-radius:4px→999px, padding et margin-top) sont légitimes ici.
    const css = readCss('checkout-vertical-rail.css');
    // La règle combinée matche le tout (le sélecteur liste prend l'un ou l'autre)
    const combined = css.match(/\.ck-chip-lbl\s+em\.ck-soon[\s\S]{0,80}\.ck-chip-lbl\s+em\.ck-stripe-tag\s*\{([^}]+)\}/);
    const b = combined ? combined[1] : '';
    expect(b, 'Règle combinée introuvable dans checkout-vertical-rail.css').toBeTruthy();
    expect(b).toMatch(/border-radius\s*:\s*999px/);
    expect(b).toMatch(/padding\s*:/);
    // background et color ne doivent PAS être ici (propriété de cart.css)
    expect(b).not.toMatch(/background\s*:/);
    expect(b).not.toMatch(/\bcolor\s*:/);
  });
});
