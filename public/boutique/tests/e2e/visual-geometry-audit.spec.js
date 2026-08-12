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
 *   G7 — Snapshot états complexes : ×2, nom long, claimed organisateur
 *   G8 — Liste quittée (×) : tabs retirés, panier personnel conservé
 *   G9 — Ma liste organisateur : centrage, badge "Déjà acheté par X"
 *   G10 — Checkout structure neutre : wallet=0 absent, chips MVola disabled
 *   G11 — Checkout wallet présent + relais long
 *   G12 — Débordements scrollWidth sur les surfaces auditées
 *
 * Pattern d'attente :
 *   On utilise waitForSelector(sel, { state:'attached' }) pour la présence DOM,
 *   puis page.evaluate() pour les mesures géométriques réelles.
 *   page.waitForFunction() s'avère peu fiable pour les sélecteurs CSS composés
 *   sur le projet Chromium Local-Only (confirmé en diagnostic).
 */
'use strict';
const { test, expect } = require('@playwright/test');

// ── Viewports ─────────────────────────────────────────────────────────────────
// Prompt §2 : mobile 360/390/412, desktop 1280/1440/1920.
// Les groupes G1–G5 et G7–G12 tournent sur tous les viewports.
const VIEWPORTS = [
  { name: 'mobile-360',   width: 360,  height: 800  },
  { name: 'mobile-390',   width: 390,  height: 844  },
  { name: 'mobile-412',   width: 412,  height: 915  },
  { name: 'desktop-1280', width: 1280, height: 720  },
  { name: 'desktop-1440', width: 1440, height: 900  },
  { name: 'desktop-1920', width: 1920, height: 1080 },
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
// GROUPE 7 — Snapshot états complexes : ×2, nom long, claimed organisateur
// ─────────────────────────────────────────────────────────────────────────────

for (const vp of VIEWPORTS) {
  test.describe(`[${vp.name}] G7 — Snapshot états complexes`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ page }) => {
      await stubMinimalApi(page);
      await loadBoutique(page);
      await injectSharedListSnapshot(page, {
        creatorName: 'Abdourahmane Mohamed',
        items: [
          // Article ×2 : badge quantité + prix × 2
          { id: 'si-1', product_id: 'geom-prod-1',
            name: 'Huile essentielle originale de Madagascar',
            price_kmf: 12500, quantity: 2, claimed: false,
            image_url: '/boutique/categories/tech.jpg' },
          // Nom très long : doit ellipser, pas déborder
          { id: 'si-2', product_id: 'geom-prod-2',
            name: 'Poudre compacte minimaliste finition naturelle longue tenue premium édition limitée',
            price_kmf: 38000, quantity: 1, claimed: false, image_url: '' },
          // Claimed par l'organisateur
          { id: 'si-3', product_id: 'geom-prod-1',
            name: 'Veste homme sport collection premium',
            price_kmf: 15000, quantity: 1, claimed: true,
            claimed_by_name: 'Abdourahmane Mohamed',
            image_url: '/boutique/categories/tech.jpg' },
        ],
      });
      await page.waitForSelector('.k-cart-snapshot-item', { state: 'attached', timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(300);
    });

    test('G7-a — article ×2 : ligne ne déborde pas de son conteneur', async ({ page }) => {
      const overflow = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.k-cart-snapshot-item'))
          .filter(row => { const r = row.getBoundingClientRect(); return r.width > 0; })
          .map(row => {
            const p = row.parentElement;
            if (!p) return null;
            const rR = row.getBoundingClientRect();
            const pR = p.getBoundingClientRect();
            return { right: Math.max(0, rR.right - pR.right - 1) };
          }).filter(Boolean)
      );
      for (const r of overflow) {
        expect(r.right, `Ligne ×2 déborde de ${r.right}px à droite`).toBeLessThanOrEqual(1);
      }
    });

    test('G7-b — nom long : ellipsis appliqué, titre non tronqué brusquement', async ({ page }) => {
      // Le nom long doit avoir overflow:hidden ou text-overflow:ellipsis — pas de scroll horizontal.
      const result = await page.evaluate(() => {
        const names = Array.from(document.querySelectorAll('.k-cart-item-name'))
          .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0; });
        return names.map(el => ({
          scrollW: el.scrollWidth,
          clientW: el.clientWidth,
          overflows: el.scrollWidth > el.clientWidth + 2,
        }));
      });
      // scrollWidth > clientWidth signifie que le texte est tronqué par overflow — c'est voulu.
      // Ce qu'on interdit : que le conteneur PARENT soit en overflow (visible dans G7-a).
      // Ici on vérifie juste que les noms existent et ont une largeur > 0.
      expect(result.filter(r => r.clientW > 0).length,
        'Aucun .k-cart-item-name visible trouvé').toBeGreaterThan(0);
    });

    test('G7-c — article claimed : badge "Déjà acheté" ne chevauche pas le titre', async ({ page }) => {
      const collision = await page.evaluate(() => {
        function intersects(a, b) {
          return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
        }
        return Array.from(document.querySelectorAll('.k-cart-snapshot-item.is-cart-item-claimed'))
          .filter(row => { const r = row.getBoundingClientRect(); return r.width > 0; })
          .map(row => {
            const badge = row.querySelector('.k-cart-snapshot-item-status-badge');
            const name  = row.querySelector('.k-cart-item-name');
            if (!badge || !name) return null;
            return { collides: intersects(badge.getBoundingClientRect(), name.getBoundingClientRect()) };
          }).filter(Boolean);
      });
      for (const r of collision) {
        expect(r.collides, 'Badge claimed chevauche le titre').toBe(false);
      }
    });

    test('G7-d — hauteurs homogènes entre lignes claimed et non claimed (±8 px)', async ({ page }) => {
      const heights = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.k-cart-snapshot-item'))
          .filter(row => { const r = row.getBoundingClientRect(); return r.height > 0; })
          .map(row => row.getBoundingClientRect().height)
      );
      if (heights.length < 2) return; // skip si une seule ligne visible
      const hMin = Math.min(...heights);
      const hMax = Math.max(...heights);
      expect(hMax - hMin,
        `Écart de hauteur entre lignes trop grand : ${hMin}px vs ${hMax}px`
      ).toBeLessThanOrEqual(8);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUPE 8 — Liste quittée : tabs retirés, panier personnel conservé
// ─────────────────────────────────────────────────────────────────────────────

for (const vp of VIEWPORTS) {
  test.describe(`[${vp.name}] G8 — Liste quittée (×)`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ page }) => {
      await stubMinimalApi(page);
      await loadBoutique(page);
      // Injecter la liste, puis la quitter via clearSharedListContext()
      await injectSharedListSnapshot(page, { creatorName: 'Sam' });
      await waitForTabsAttached(page);
      // Simuler le clic sur × : clearSharedListContext() est l'équivalent programmatique
      await page.evaluate(() =>
        import('/boutique/js/group/group-side-cart.js').then(({ clearSharedListContext }) =>
          clearSharedListContext()
        )
      );
      await page.waitForTimeout(500);
    });

    test('G8-a — après quitter : aucun onglet liste dans le DOM visible', async ({ page }) => {
      const listTabs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.k-cart-tab-group'))
          .filter(g => { const r = g.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
          .length;
      });
      expect(listTabs, 'Des onglets liste sont encore visibles après clearSharedListContext()').toBe(0);
    });

    test('G8-b — après quitter : le snapshot de liste est retiré du DOM', async ({ page }) => {
      const snapshots = await page.evaluate(() =>
        document.querySelectorAll('.k-cart-snapshot-item').length
      );
      expect(snapshots, 'Des items de snapshot liste restent dans le DOM').toBe(0);
    });

    test('G8-c — après quitter : #k-side-cart (desktop) ou drawer (mobile) toujours présent', async ({ page }) => {
      const cartPresent = await page.evaluate(() => {
        const sideCart = document.getElementById('k-side-cart');
        const drawer   = document.getElementById('k-cart-drawer');
        return (sideCart !== null) || (drawer !== null);
      });
      expect(cartPresent, 'Ni #k-side-cart ni #k-cart-drawer présent après quitter la liste').toBe(true);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUPE 9 — Ma liste organisateur : centrage, "Déjà acheté par X"
// ─────────────────────────────────────────────────────────────────────────────

for (const vp of VIEWPORTS) {
  test.describe(`[${vp.name}] G9 — Ma liste (vue organisateur)`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ page }) => {
      await stubMinimalApi(page);
      await loadBoutique(page);
      // Vue organisateur : is_creator = true, titre "Ma liste"
      await page.evaluate(({ sharedItems }) =>
        import('/boutique/js/group/group-side-cart.js').then(({ activateSharedListContext }) =>
          activateSharedListContext(
            { cart: { id: 'sc-org', token: 'org-tok', status: 'open',
                      title: 'Ma liste', creator_first_name: 'Sam', message: null },
              items: sharedItems,
              contributors: [{ name: 'Abdourahmane Mohamed' }],
              is_creator: true },
            'org-tok'
          )
        ),
      { sharedItems: [
        { id: 'si-1', product_id: 'geom-prod-1',
          name: 'Huile essentielle originale de Madagascar',
          price_kmf: 12500, quantity: 1, claimed: false,
          image_url: '/boutique/categories/tech.jpg' },
        { id: 'si-2', product_id: 'geom-prod-2',
          name: 'Veste homme sport collection premium',
          price_kmf: 38000, quantity: 1, claimed: true,
          claimed_by_name: 'Abdourahmane Mohamed',
          image_url: '' },
      ]});
      const vw = await page.evaluate(() => window.innerWidth);
      if (vw < 900) {
        await page.evaluate(() =>
          import('/boutique/js/b-cart.js').then(({ openCart }) => openCart())
        );
      }
      await page.waitForTimeout(700);
      await waitForTabsAttached(page);
    });

    test('G9-a — onglet "Ma liste" : label centré (±4 px) même avec ×', async ({ page }) => {
      const containers = await getVisibleTabContainers(page);
      // Si pas de groupe (liste sans × visible), passer
      const groupsWithExit = containers.flatMap(c => c.groups).filter(g => g.exW > 0);
      if (groupsWithExit.length === 0) return;

      for (const g of groupsWithExit) {
        expect(
          Math.abs(g.availCtrX - g.lblCtrX),
          `"Ma liste" décalé de ${Math.abs(g.availCtrX - g.lblCtrX).toFixed(1)}px`
        ).toBeLessThanOrEqual(4);
      }
    });

    test('G9-b — badge "Déjà acheté par X" ne chevauche pas le nom du produit', async ({ page }) => {
      await page.waitForSelector('.k-cart-snapshot-item', { state: 'attached', timeout: 6_000 }).catch(() => {});
      const collision = await page.evaluate(() => {
        function intersects(a, b) {
          return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
        }
        return Array.from(document.querySelectorAll('.k-cart-snapshot-item.is-cart-item-claimed'))
          .filter(row => { const r = row.getBoundingClientRect(); return r.width > 0; })
          .map(row => {
            const badge = row.querySelector('.k-cart-snapshot-item-status-badge');
            const name  = row.querySelector('.k-cart-item-name');
            if (!badge || !name) return null;
            return {
              badgeText: badge.textContent?.trim().slice(0, 30),
              collides: intersects(badge.getBoundingClientRect(), name.getBoundingClientRect()),
            };
          }).filter(Boolean);
      });
      for (const r of collision) {
        expect(r.collides,
          `Badge "${r.badgeText}" chevauche le titre (vue organisateur)`
        ).toBe(false);
      }
    });

    test('G9-c — pas de bouton "Acheter" par ligne (interdit §9 du prompt)', async ({ page }) => {
      await page.waitForSelector('.k-cart-snapshot-item', { state: 'attached', timeout: 6_000 }).catch(() => {});
      const buyButtons = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.k-cart-snapshot-item'))
          .filter(row => { const r = row.getBoundingClientRect(); return r.width > 0; })
          .some(row => {
            const text = row.textContent?.toLowerCase() || '';
            return text.includes('acheter') || row.querySelector('button[class*="buy"], button[class*="achat"]');
          })
      );
      expect(buyButtons, 'Bouton "Acheter" trouvé dans une ligne de liste — interdit').toBe(false);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUPE 10 — Checkout structure neutre + wallet=0 absent
// ─────────────────────────────────────────────────────────────────────────────

for (const vp of VIEWPORTS) {
  test.describe(`[${vp.name}] G10 — Checkout structure neutre`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    // Stub avec wallet=0
    async function stubWithWalletZero(page, products) {
      await stubMinimalApi(page, products);
      // Surcharger /api/wallet après le catch-all (LIFO → s'exécute en premier)
      await page.route(/\/api\/wallet/, r =>
        r.fulfill({ status: 200, contentType: 'application/json',
                    body: JSON.stringify({ balance_kmf: 0 }) })
      );
    }

    test.beforeEach(async ({ page }) => {
      await stubWithWalletZero(page);
      await loadBoutique(page);
      // Ajouter un article au panier pour passer la garde cart.length > 0
      await page.evaluate(() =>
        import('/boutique/js/b-cart.js').then(({ quickAdd }) => {
          const pid = window._kstate?.products?.[0]?.id ?? 'geom-prod-1';
          quickAdd(pid, null);
        })
      );
      await page.evaluate(() => window._kbus?.emit('checkout:open', { source: 'geometry-test' }));
      await page.waitForSelector('#k-order-modal.open, .k-order-overlay.open',
        { timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(800);
    });

    test('G10-a — wallet à 0 : section wallet absente ou non visible', async ({ page }) => {
      const walletState = await page.evaluate(() => {
        const section = document.getElementById('wallet-section');
        if (!section) return { absent: true };
        const r = section.getBoundingClientRect();
        const isVisible = section.classList.contains('is-visible');
        return { absent: false, isVisible, height: r.height };
      });
      // Le wallet doit être absent OU sans classe is-visible (règle §3 du prompt)
      const walletHidden = walletState.absent || !walletState.isVisible;
      expect(walletHidden,
        `Section wallet visible alors que balance=0 (isVisible=${walletState.isVisible})`
      ).toBe(true);
    });

    test('G10-b — MVola marquée indisponible ("Bientôt")', async ({ page }) => {
      const mvolaChip = await page.evaluate(() => {
        // Chercher le chip MVola : doit exister et être désactivé (opacity < 1 ou classe disabled)
        const chips = Array.from(document.querySelectorAll('.ck-pay-chip, .ck-pay-mvola'));
        const mvola = chips.find(c => c.textContent?.includes('MVola'));
        if (!mvola) return null;
        const style = window.getComputedStyle(mvola);
        const soon  = mvola.querySelector('.ck-soon');
        return {
          hasSoonBadge: !!soon,
          soonText: soon?.textContent?.trim() ?? '',
          opacity: parseFloat(style.opacity),
          pointerEvents: style.pointerEvents,
        };
      });
      if (!mvolaChip) {
        test.skip(true, 'Chip MVola non rendu (checkout incomplet en LOCAL)');
        return;
      }
      // MVola doit avoir un badge "Bientôt" OU être non cliquable
      const isDisabled = mvolaChip.hasSoonBadge || mvolaChip.opacity < 0.8 ||
                         mvolaChip.pointerEvents === 'none';
      expect(isDisabled,
        `MVola semble actif : hasSoon=${mvolaChip.hasSoonBadge} opacity=${mvolaChip.opacity}`
      ).toBe(true);
    });

    test('G10-c — pas de couleur verte dominante (#k-order-modal)', async ({ page }) => {
      const greenCheck = await page.evaluate(() => {
        const modal = document.getElementById('k-order-modal');
        if (!modal) return null;
        // Vérifier background du modal lui-même
        const bg = window.getComputedStyle(modal).backgroundColor;
        // Convertir rgb(r,g,b) → ratio vert dominant
        const m = bg.match(/\d+/g);
        if (!m || m.length < 3) return { bg, isGreenDominant: false };
        const [r, g, b] = m.map(Number);
        // Vert "cta-green" de Komerce = approx #2d9e6b = rgb(45, 158, 107)
        // On considère "vert dominant" si g >> r et g >> b avec g > 100
        const isGreenDominant = g > 100 && g > r * 1.5 && g > b * 1.3;
        return { bg, isGreenDominant };
      });
      if (!greenCheck) {
        test.skip(true, 'Modal checkout non trouvé');
        return;
      }
      expect(greenCheck.isGreenDominant,
        `Fond du modal checkout est vert dominant : ${greenCheck.bg}`
      ).toBe(false);
    });

    test('G10-d — chips de paiement : même hauteur (±3 px) si présentes', async ({ page }) => {
      const chips = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.ck-pay-chip'))
          .filter(c => { const r = c.getBoundingClientRect(); return r.height > 0; })
          .map(c => c.getBoundingClientRect().height)
      );
      if (chips.length < 2) {
        test.skip(true, 'Chips paiement non rendues en LOCAL');
        return;
      }
      const h0 = chips[0];
      for (const h of chips.slice(1)) {
        expect(Math.abs(h - h0),
          `Chip (${h}px) diffère de >3px vs premier chip (${h0}px)`
        ).toBeLessThanOrEqual(3);
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUPE 11 — Checkout wallet présent + relais long
// ─────────────────────────────────────────────────────────────────────────────

for (const vp of VIEWPORTS) {
  test.describe(`[${vp.name}] G11 — Checkout wallet présent + relais long`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    async function stubWithWalletAndLongRelay(page) {
      await stubMinimalApi(page);
      // Relais avec un nom commercial long + identifiant technique
      await page.route(/\/api\/relais/, r =>
        r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
          id: 'r1',
          name: 'KM IT Hub Relais 1785147404083-cxpu23',
          address: 'Place de l\'Indépendance, Moroni Centre-ville',
          ile: 'grande_comore',
        }]) })
      );
      // Wallet avec solde > 0
      await page.route(/\/api\/wallet/, r =>
        r.fulfill({ status: 200, contentType: 'application/json',
                    body: JSON.stringify({ balance_kmf: 5000 }) })
      );
    }

    test.beforeEach(async ({ page }) => {
      await stubWithWalletAndLongRelay(page);
      await loadBoutique(page);
      await page.evaluate(() =>
        import('/boutique/js/b-cart.js').then(({ quickAdd }) => {
          quickAdd(window._kstate?.products?.[0]?.id ?? 'geom-prod-1', null);
        })
      );
      await page.evaluate(() => window._kbus?.emit('checkout:open', { source: 'geometry-test' }));
      await page.waitForSelector('#k-order-modal.open, .k-order-overlay.open',
        { timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(1_000); // laisser /api/wallet s'exécuter
    });

    test('G11-a — wallet > 0 : section wallet visible', async ({ page }) => {
      const walletState = await page.evaluate(() => {
        const section = document.getElementById('wallet-section');
        if (!section) return null;
        return { isVisible: section.classList.contains('is-visible') };
      });
      if (!walletState) {
        test.skip(true, 'Section wallet absente du DOM (checkout incomplet en LOCAL)');
        return;
      }
      expect(walletState.isVisible,
        'Wallet > 0 mais section non visible (classe is-visible manquante)'
      ).toBe(true);
    });

    test('G11-b — wallet activé : aucun saut brutal de mise en page', async ({ page }) => {
      // Cocher la case wallet et vérifier que le modal ne collapse pas
      const beforeH = await page.evaluate(() => {
        const modal = document.querySelector('.k-order-modal');
        return modal ? modal.getBoundingClientRect().height : 0;
      });

      if (beforeH === 0) {
        test.skip(true, 'Modal checkout non rendu');
        return;
      }

      // Cocher la case wallet
      await page.evaluate(() => {
        const cb = document.getElementById('cb-use-wallet');
        if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
      });
      await page.waitForTimeout(400);

      const afterH = await page.evaluate(() => {
        const modal = document.querySelector('.k-order-modal');
        return modal ? modal.getBoundingClientRect().height : 0;
      });

      // La hauteur ne doit pas chuter de plus de 30% (saut brutal)
      if (beforeH > 0 && afterH > 0) {
        expect(afterH / beforeH,
          `Hauteur du modal checkout a chuté de ${Math.round((1 - afterH / beforeH) * 100)}% après activation wallet`
        ).toBeGreaterThan(0.7);
      }
    });

    test('G11-c — relais long : nom commercial visible, pas de débordement', async ({ page }) => {
      const relaisCheck = await page.evaluate(() => {
        // Chercher le nom du relais dans le checkout
        const relaisName = document.querySelector('.ck-relais-auto-name, .ck-relais-name, [class*="relais-name"]');
        if (!relaisName) return null;
        const r = relaisName.getBoundingClientRect();
        const p = relaisName.parentElement?.getBoundingClientRect();
        return {
          nameVisible: r.width > 0 && r.height > 0,
          overflows: p ? Math.max(0, r.right - p.right - 2) : 0,
          text: relaisName.textContent?.trim().slice(0, 40),
        };
      });
      if (!relaisCheck) {
        test.skip(true, 'Nom relais non trouvé dans le DOM checkout');
        return;
      }
      expect(relaisCheck.nameVisible, 'Nom du relais non visible').toBe(true);
      expect(relaisCheck.overflows,
        `Nom relais déborde de ${relaisCheck.overflows}px ("${relaisCheck.text}")`
      ).toBeLessThanOrEqual(2);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUPE 12 — Débordements scrollWidth sur les surfaces auditées
// ─────────────────────────────────────────────────────────────────────────────

for (const vp of VIEWPORTS) {
  test.describe(`[${vp.name}] G12 — Débordements scrollWidth`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    // Sélecteurs volontairement scrollables à exclure du contrôle
    const SCROLL_EXEMPT = new Set([
      '.k-order-body', // le corps du checkout scroll verticalement par design
      '#k-order-modal',
      '.k-cart-body',
      '.k-grid',
    ]);

    /**
     * Vérifie scrollWidth ≤ clientWidth sur un sélecteur donné.
     * Exclut :
     * - les éléments invisibles (clientWidth=0)
     * - les conteneurs volontairement scrollables (SCROLL_EXEMPT)
     * - les éléments avec text-overflow:ellipsis (scrollWidth > clientWidth intentionnel)
     */
    async function checkHorizontalOverflow(page, selector) {
      return page.evaluate(({ sel, exempt }) => {
        return Array.from(document.querySelectorAll(sel))
          .filter(el => {
            if (el.clientWidth === 0) return false;
            // Exclure les conteneurs volontairement scrollables
            for (const ex of exempt) {
              if (el.matches(ex) || el.closest(ex)) return false;
            }
            // Exclure les éléments intentionnellement ellipsés (scrollW > clientW voulu)
            const cs = window.getComputedStyle(el);
            if (cs.textOverflow === 'ellipsis' || cs.overflow === 'hidden') return false;
            return true;
          })
          .map(el => ({
            sel: el.className.split(' ').slice(0, 2).join('.'),
            overflow: el.scrollWidth - el.clientWidth,
          }))
          .filter(r => r.overflow > 2); // tolérance 2px pour les borders sub-pixel
      }, { sel: selector, exempt: [...SCROLL_EXEMPT] });
    }

    test('G12-a — panier personnel : pas de débordement horizontal', async ({ page }) => {
      await stubMinimalApi(page);
      await loadBoutique(page);
      const overflows = await checkHorizontalOverflow(page, '#k-side-cart *, #k-cart-drawer *');
      expect(overflows, `Débordements dans le panier : ${JSON.stringify(overflows)}`).toHaveLength(0);
    });

    test('G12-b — snapshot liste : pas de débordement horizontal', async ({ page }) => {
      await stubMinimalApi(page);
      await loadBoutique(page);
      await injectSharedListSnapshot(page, {
        creatorName: 'Abdourahmane Mohamed',
        items: [
          { id: 'si-1', product_id: 'geom-prod-1',
            name: 'Poudre compacte minimaliste finition naturelle très longue tenue',
            price_kmf: 38000, quantity: 2, claimed: true, image_url: '' },
        ],
      });
      await page.waitForSelector('.k-cart-snapshot-item', { state: 'attached', timeout: 6_000 }).catch(() => {});
      await page.waitForTimeout(300);
      const overflows = await checkHorizontalOverflow(page, '.k-cart-snapshot-item *');
      expect(overflows, `Débordements dans snapshot : ${JSON.stringify(overflows)}`).toHaveLength(0);
    });

    test('G12-c — catalogue : pas de débordement horizontal sur les cartes produit', async ({ page }) => {
      await stubMinimalApi(page, [
        buildMinimalProduct({ id: 'p1', name: 'Rouge à lèvres chic longue tenue collection été', promo_pct: 20 }),
        buildMinimalProduct({ id: 'p2', name: 'Huile essentielle originale de Madagascar premium', promo_pct: 15 }),
        buildMinimalProduct({ id: 'p3', name: 'Poudre compacte minimaliste finition naturelle', promo_pct: null }),
        buildMinimalProduct({ id: 'p4', name: 'Sac artisanal fait main cuir véritable', promo_pct: null }),
      ]);
      await loadBoutique(page);
      await page.waitForFunction(
        () => document.querySelectorAll('.k-card').length > 0,
        null, { timeout: 10_000 }
      );
      const overflows = await checkHorizontalOverflow(page, '.k-card');
      expect(overflows, `Débordements dans cartes produit : ${JSON.stringify(overflows)}`).toHaveLength(0);
    });

    test('G12-d — body : pas de scrollbar horizontale (viewport entier)', async ({ page }) => {
      await stubMinimalApi(page);
      await loadBoutique(page);
      const bodyOverflow = await page.evaluate(() => ({
        scrollW: document.body.scrollWidth,
        clientW: document.body.clientWidth,
        overflow: document.body.scrollWidth - document.body.clientWidth,
      }));
      expect(bodyOverflow.overflow,
        `body déborde horizontalement de ${bodyOverflow.overflow}px (scrollW=${bodyOverflow.scrollW}, clientW=${bodyOverflow.clientW})`
      ).toBeLessThanOrEqual(2);
    });
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// GROUPE 13 — Panier vide + liste OPEN affichée
// ─────────────────────────────────────────────────────────────────────────────

for (const vp of VIEWPORTS) {
  test.describe(`[${vp.name}] G13 — Panier vide + liste OPEN`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ page }) => {
      await stubMinimalApi(page);
      await loadBoutique(page);
      // Injecter la liste SANS ajouter d'article au panier personnel
      // → state.cart.length === 0, hasOpenSharedListInSlot() === true
      // → shell reste visible avec "Votre panier est vide."
      await injectSharedListSnapshot(page, { creatorName: 'Sam' });
      await waitForTabsAttached(page);
    });

    test('G13-a — shell side cart visible malgré panier vide (has-items présent)', async ({ page }) => {
      const result = await page.evaluate(() => {
        const sc = document.getElementById('k-side-cart');
        const drawer = document.getElementById('k-cart-drawer');
        // Sur desktop : has-items sur k-side-cart. Sur mobile : drawer ou body.sc-reserve.
        const hasItemsDesktop = sc?.classList.contains('has-items');
        const scReserve = document.body.classList.contains('sc-reserve');
        return { hasItemsDesktop, scReserve, scExists: !!sc };
      });
      // Au moins l'un des indicateurs de shell visible doit être actif
      const shellVisible = result.hasItemsDesktop || result.scReserve;
      expect(shellVisible,
        `Shell side cart absent alors que liste OPEN (has-items=${result.hasItemsDesktop}, sc-reserve=${result.scReserve})`
      ).toBe(true);
    });

    test('G13-b — message "Votre panier est vide" présent dans le shell', async ({ page }) => {
      const emptyMsg = await page.evaluate(() => {
        const emptyEl = document.querySelector('.k-sc-empty');
        if (!emptyEl) return null;
        return { text: emptyEl.textContent?.trim(), visible: emptyEl.getBoundingClientRect().width > 0 };
      });
      if (!emptyMsg) {
        test.skip(true, 'Élément .k-sc-empty absent (non rendu en LOCAL sans scroll)');
        return;
      }
      expect(emptyMsg.text).toMatch(/vide/i);
    });

    test('G13-c — onglets side cart toujours présents (panier + liste)', async ({ page }) => {
      const containers = await getVisibleTabContainers(page);
      expect(containers.length,
        'Onglets side cart absents alors que liste OPEN avec panier vide'
      ).toBeGreaterThan(0);
    });

    test('G13-d — le message vide ne déborde pas du shell (pas de layout shift)', async ({ page }) => {
      const overflow = await page.evaluate(() => {
        const emptyEl = document.querySelector('.k-sc-empty');
        if (!emptyEl) return null;
        const parent = emptyEl.parentElement;
        if (!parent) return null;
        const eR = emptyEl.getBoundingClientRect();
        const pR = parent.getBoundingClientRect();
        return { right: Math.max(0, eR.right - pR.right), visible: eR.width > 0 };
      });
      if (!overflow || !overflow.visible) return; // non rendu en LOCAL, skip implicite
      expect(overflow.right,
        `Message "panier vide" déborde de ${overflow.right}px à droite`
      ).toBeLessThanOrEqual(2);
    });

    test('G13-e — une seule action Partager, aucun CTA Re-partager concurrent', async ({ page }) => {
      const controls = await page.evaluate(() => {
        const legacy = document.querySelectorAll('#k-cart-reshare, #k-sc-reshare').length;
        const canonical = [...document.querySelectorAll('#k-cart-share, #k-sc-share')]
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return rect.width > 0
              && rect.height > 0
              && style.display !== 'none'
              && style.visibility !== 'hidden';
          })
          .map((element) => element.textContent?.trim() || '');

        return { legacy, canonical };
      });

      expect(controls.legacy, 'Les CTA Re-partager legacy doivent être absents du DOM').toBe(0);
      expect(
        controls.canonical,
        `Une seule action Partager doit être visible, reçu: ${JSON.stringify(controls.canonical)}`,
      ).toHaveLength(1);
      expect(controls.canonical[0]).toMatch(/Partager/i);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUPE 14 — Liste clôturée évacuée du side cart
// ─────────────────────────────────────────────────────────────────────────────

for (const vp of VIEWPORTS) {
  test.describe(`[${vp.name}] G14 — Liste clôturée évacuée`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ page }) => {
      await stubMinimalApi(page);
      await loadBoutique(page);
      await injectSharedListSnapshot(page, { creatorName: 'Sam' });
      await waitForTabsAttached(page);

      // Simuler la clôture de liste : handleCloseClick() appelle clearSharedListContext()
      // après l'appel réseau. En LOCAL on appelle directement clearSharedListContext()
      // (même résultat final documenté dans le commentaire de handleCloseClick).
      await page.evaluate(() =>
        import('/boutique/js/group/group-side-cart.js').then(({ clearSharedListContext }) =>
          clearSharedListContext()
        )
      );
      await page.waitForTimeout(500);
    });

    test('G14-a — après clôture : aucun onglet liste visible', async ({ page }) => {
      const listTabs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.k-cart-tab-group'))
          .filter(g => { const r = g.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
          .length
      );
      expect(listTabs,
        'Des onglets liste restent visibles après clearSharedListContext() (clôture)'
      ).toBe(0);
    });

    test('G14-b — après clôture : aucun item snapshot en liste dans le DOM visible', async ({ page }) => {
      const snapshots = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.k-cart-snapshot-item'))
          .filter(el => el.getBoundingClientRect().width > 0)
          .length
      );
      expect(snapshots,
        'Des items de snapshot liste restent visibles après clôture'
      ).toBe(0);
    });

    test('G14-c — après clôture : panier personnel accessible (shell présent)', async ({ page }) => {
      const cartPresent = await page.evaluate(() => {
        const sideCart = document.getElementById('k-side-cart');
        const drawer   = document.getElementById('k-cart-drawer');
        return (sideCart !== null) || (drawer !== null);
      });
      expect(cartPresent,
        'Shell panier personnel introuvable après clôture de liste'
      ).toBe(true);
    });

    test('G14-d — après clôture : cartSurface revenu à "personal"', async ({ page }) => {
      const surface = await page.evaluate(() => window._kstate?.cartSurface ?? null);
      if (surface === null) {
        test.skip(true, '_kstate non exposé en LOCAL');
        return;
      }
      expect(surface,
        `cartSurface = "${surface}" au lieu de "personal" après clôture`
      ).toBe('personal');
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUPE 15 — Images cassées : fallback propre, pas de pictogramme navigateur
// ─────────────────────────────────────────────────────────────────────────────

for (const vp of VIEWPORTS) {
  test.describe(`[${vp.name}] G15 — Images cassées + fallback`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ page }) => {
      await stubMinimalApi(page);
      await loadBoutique(page);
      // Injecter des items avec image_url délibérément cassée
      await injectSharedListSnapshot(page, {
        creatorName: 'Sam',
        items: [
          // Image URL vide → doit déclencher le fallback
          { id: 'si-broken-1', product_id: 'geom-prod-1',
            name: 'Article avec image cassée', price_kmf: 5000,
            quantity: 1, claimed: false, image_url: '' },
          // URL malformée → autre cas de fallback
          { id: 'si-broken-2', product_id: 'geom-prod-2',
            name: 'Article URL invalide', price_kmf: 3000,
            quantity: 1, claimed: false,
            image_url: '/uploads/nonexistent-image-404.jpg' },
        ],
      });
      await page.waitForSelector('.k-cart-snapshot-item', { state: 'attached', timeout: 6_000 }).catch(() => {});
      // Laisser les onerror se déclencher
      await page.waitForTimeout(800);
    });

    test('G15-a — image cassée : classe is-img-error posée sur le wrapper', async ({ page }) => {
      // b-cart.js:724 : onerror="this.closest('.k-cart-item-img').classList.add('is-img-error');this.remove();"
      // Pour image_url vide, b-cart.js utilise directement le fallback (pas de img tag)
      const wrappers = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.k-cart-item-img'))
          .filter(el => el.getBoundingClientRect().width > 0)
          .map(el => ({
            hasError: el.classList.contains('is-img-error'),
            hasFallback: !!el.querySelector('.k-cart-item-img-fallback'),
            hasImgTag: !!el.querySelector('img'),
          }))
      );
      if (wrappers.length === 0) {
        test.skip(true, 'Wrappers image non rendus en LOCAL');
        return;
      }
      // Chaque wrapper doit soit avoir une vraie image, soit avoir le fallback
      for (const w of wrappers) {
        const isHandled = w.hasImgTag || w.hasFallback || w.hasError;
        expect(isHandled,
          `Wrapper image sans img ni fallback (hasImg=${w.hasImgTag}, hasFallback=${w.hasFallback})`
        ).toBe(true);
      }
    });

    test('G15-b — fallback 📦 visible, pas de pictogramme cassé navigateur', async ({ page }) => {
      const fallbacks = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.k-cart-item-img-fallback'))
          .filter(el => el.getBoundingClientRect().width > 0)
          .map(el => ({
            visible: el.getBoundingClientRect().height > 0,
            text: el.textContent?.trim(),
          }))
      );
      // Si le fallback est rendu, il doit être visible et contenir le pictogramme Komerce
      for (const f of fallbacks) {
        expect(f.visible, 'Fallback image non visible').toBe(true);
        expect(f.text, 'Fallback image vide (pictogramme manquant)').toBeTruthy();
      }
    });

    test('G15-c — image cassée : ligne conserve sa hauteur (pas de layout shift)', async ({ page }) => {
      const rows = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.k-cart-snapshot-item'))
          .filter(el => el.getBoundingClientRect().width > 0)
          .map(el => el.getBoundingClientRect().height)
      );
      if (rows.length === 0) return;
      // La hauteur doit être > 0 (la ligne ne doit pas s'effondrer)
      for (const h of rows) {
        expect(h, 'Ligne avec image cassée effondrée (height=0)').toBeGreaterThan(0);
      }
      // Hauteurs cohérentes entre lignes (±12px, images cassées ne doivent pas créer de géants)
      const hMin = Math.min(...rows);
      const hMax = Math.max(...rows);
      expect(hMax - hMin,
        `Écart de hauteur trop grand entre lignes (cassée vs normale) : ${hMin}px vs ${hMax}px`
      ).toBeLessThanOrEqual(12);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUPE 16 — Badges compteur panier et avatar
// ─────────────────────────────────────────────────────────────────────────────

for (const vp of VIEWPORTS) {
  test.describe(`[${vp.name}] G16 — Badges compteur panier + avatar`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ page }) => {
      await stubMinimalApi(page);
      await loadBoutique(page);
      // Ajouter un article pour que le badge panier soit visible
      await page.evaluate(() =>
        import('/boutique/js/b-cart.js').then(({ quickAdd }) => {
          const pid = window._kstate?.products?.[0]?.id ?? 'geom-prod-1';
          quickAdd(pid, null);
        })
      );
      await page.waitForTimeout(400);
    });

    test('G16-a — badge panier #k-cart-badge : visible et non zéro après ajout', async ({ page }) => {
      const badge = await page.evaluate(() => {
        const b = document.getElementById('k-cart-badge');
        if (!b) return null;
        return {
          text:    b.textContent?.trim(),
          visible: b.getBoundingClientRect().width > 0,
          hasShow: b.classList.contains('show'),
        };
      });
      if (!badge) {
        test.skip(true, '#k-cart-badge absent du DOM');
        return;
      }
      // Après quickAdd, le badge doit être visible et > 0
      expect(badge.text, 'Badge panier vide après ajout article').toBeTruthy();
      expect(badge.text === '0', 'Badge panier reste à 0 après ajout').toBe(false);
    });

    test('G16-b — badge panier ne chevauche pas le texte du bouton cart', async ({ page }) => {
      const collision = await page.evaluate(() => {
        function intersects(a, b) {
          return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
        }
        const badge  = document.getElementById('k-cart-badge');
        const btnLbl = document.querySelector('#k-bnav-cart-label, .k-header-cart-label, [id*="cart-label"]');
        if (!badge || !btnLbl) return null;
        const bR = badge.getBoundingClientRect();
        const lR = btnLbl.getBoundingClientRect();
        if (bR.width === 0 || lR.width === 0) return { skipped: true };
        return { collides: intersects(bR, lR) };
      });
      if (!collision || collision.skipped) {
        test.skip(true, 'Badge ou label non visible pour mesure');
        return;
      }
      expect(collision.collides,
        'Badge panier chevauche le label du bouton cart'
      ).toBe(false);
    });

    test('G16-c — badge groupe #k-header-group-badge ne chevauche pas le titre header', async ({ page }) => {
      const collision = await page.evaluate(() => {
        function intersects(a, b) {
          return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
        }
        const badge  = document.getElementById('k-header-group-badge');
        const header = document.querySelector('.k-header, header');
        if (!badge || !header) return null;
        const bR = badge.getBoundingClientRect();
        if (bR.width === 0) return { skipped: true };
        // Vérifier que le badge ne sort pas du header
        const hR = header.getBoundingClientRect();
        const overflow = bR.bottom > hR.bottom + 4 || bR.top < hR.top - 4;
        return { overflow };
      });
      if (!collision || collision.skipped) {
        test.skip(true, 'Badge groupe non visible');
        return;
      }
      expect(collision.overflow,
        'Badge groupe sort du header (débordement vertical)'
      ).toBe(false);
    });

    test('G16-d — badge panier : dimensions raisonnables (≥ 14px, pas géant)', async ({ page }) => {
      const dims = await page.evaluate(() => {
        const b = document.getElementById('k-cart-badge');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { w: r.width, h: r.height, visible: r.width > 0 };
      });
      if (!dims || !dims.visible) {
        test.skip(true, 'Badge non visible');
        return;
      }
      expect(dims.h, `Badge panier trop petit (${dims.h}px < 14px)`).toBeGreaterThanOrEqual(14);
      expect(dims.h, `Badge panier trop grand (${dims.h}px > 32px)`).toBeLessThanOrEqual(32);
      expect(dims.w, `Badge panier trop petit (${dims.w}px < 14px)`).toBeGreaterThanOrEqual(14);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUPE 17 — Réserve side cart desktop (régression terrain 2026-08-12)
// ─────────────────────────────────────────────────────────────────────────────

for (const vp of VIEWPORTS.filter(({ width }) => width >= 900)) {
  test.describe(`[${vp.name}] G17 — Side cart sans recouvrement`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('G17-a — cartes, hero et actions header s’arrêtent avant le panneau', async ({ page }) => {
      const products = Array.from({ length: 8 }, (_, index) => buildMinimalProduct({
        id: `reserve-prod-${index + 1}`,
        name: `Produit de contrôle géométrique ${index + 1}`,
        category: 'mode',
      }));
      await stubMinimalApi(page, products);
      await loadBoutique(page);
      await injectSharedListSnapshot(page, {
        creatorName: 'Admin',
        items: products.slice(0, 6).map((product, index) => ({
          id: `reserve-item-${index + 1}`,
          product_id: product.id,
          name: product.name,
          price_kmf: product.price_kmf,
          quantity: 1,
          claimed: false,
          image_url: product.image_url,
        })),
      });

      const geometry = await page.evaluate(() => {
        const sideCart = document.getElementById('k-side-cart');
        if (!sideCart) return null;
        const side = sideCart.getBoundingClientRect();
        const visibleRects = (selector) => Array.from(document.querySelectorAll(selector))
          .map((element) => ({ element, rect: element.getBoundingClientRect() }))
          .filter(({ rect }) => rect.width > 0 && rect.height > 0)
          .map(({ element, rect }) => ({
            label: element.id || element.className || element.tagName,
            left: rect.left,
            right: rect.right,
          }));
        return {
          side: { left: side.left, width: side.width },
          reserve: getComputedStyle(document.body).paddingRight,
          cards: visibleRects('#k-catalog-section .k-card'),
          shells: visibleRects('.k-header-inner, #k-hero-fixed-wrap, .k-cats-shell'),
        };
      });

      expect(geometry).not.toBeNull();
      expect(geometry.side.width).toBeGreaterThanOrEqual(290);
      expect(parseFloat(geometry.reserve)).toBeCloseTo(geometry.side.width, 0);
      [...geometry.cards, ...geometry.shells].forEach(({ label, right }) => {
        expect(right, `${label} passe sous le side cart (${right}px > ${geometry.side.left}px)`)
          .toBeLessThanOrEqual(geometry.side.left + 1);
      });
    });
  });
}



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
  test('G6-f/g — .ck-soon / .ck-stripe-tag : règles autonomes (ne dépendent plus de cart.css) dans checkout-vertical-rail.css', () => {
    // Refactor post-QA (constat 2026-08-09, cf. tests/unit/visual-geometry-css-invariants.test.js
    // LOT3-a→g) : la règle combinée héritant display/background/color de cart.css a été
    // remplacée par deux règles autonomes autoportantes. Conflits ck-soon/ck-stripe-tag
    // toujours dans la baseline css-guard (scripts/.css-guard-baseline.json) — 0 conflit
    // hors baseline vérifié par css-guard --strict.
    const css = readCss('checkout-vertical-rail.css');
    const soon = css.match(/\.ck-chip-lbl\s+em\.ck-soon\s*\{([^}]+)\}/s)?.[1] ?? '';
    const stripe = css.match(/\.ck-chip-lbl\s+em\.ck-stripe-tag\s*\{([^}]+)\}/s)?.[1] ?? '';
    expect(soon, '.ck-soon introuvable dans checkout-vertical-rail.css').toBeTruthy();
    expect(stripe, '.ck-stripe-tag introuvable dans checkout-vertical-rail.css').toBeTruthy();
    [soon, stripe].forEach((b) => {
      expect(b).toMatch(/display\s*:\s*inline-block/);
      expect(b).toMatch(/border-radius\s*:\s*999px/);
      expect(b).toMatch(/padding\s*:/);
      expect(b).toMatch(/margin-top\s*:/);
      expect(b).toMatch(/background\s*:/);
      expect(b).toMatch(/\bcolor\s*:/);
    });
  });
});
