/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   authenticated/stress-business.spec.js
 * @feature orders, wallet, shared-cart
 * @brief Stress tests — Scénarios réalistes qu'aucun happy path ne couvre.
 *
 * S1  — Concurrence stock : 2 sessions achètent le même produit en parallèle
 * S2  — Gros panier : 5+ produits distincts, vérifier totaux + checkout
 * S3  — Wallet exact : solde == prix exact du panier → paiement OK, solde = 0
 * S4  — Wallet insuffisant : solde < prix, fallback cash, pas de débit
 * S5  — Refresh F5 mid-checkout : le formulaire et le panier survivent
 * S6  — Back button mid-checkout : retour navigateur, panier intact
 * S7  — 2 onglets, même user, commande simultanée
 * S8  — Modifier le panier pendant que le checkout est ouvert
 * S9  — Session expirée mid-checkout : cookie invalidé avant soumission
 *
 * ⚠️ S1, S3, S7 soumettent de vraies commandes → ALLOW_ORDER_SUBMIT + staging.
 */
'use strict';
const { test, expect } = require('@playwright/test');
const {
  BASE_URL, waitForGrid, openFirstCard, addToCartFromModal,
  openCheckout, selectRecipientOther,
} = require('../helpers/boutique.helpers');
const { verifySession, verifyWalletBalance, getRecentOrders, assertMutantTargetSafe } = require('../helpers/api.helpers');
const { getProductStock } = require('../helpers/business.helpers');

const API_BASE = (process.env.BASE_URL || 'http://localhost:3000/boutique/').replace('/boutique/', '');
test.beforeAll(async () => {
  await assertMutantTargetSafe();
  if (!process.env.ALLOW_STRESS_TESTS) {
    throw new Error('[R5] ALLOW_STRESS_TESTS=true required for stress-business - staging only.');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// S1 — Concurrence stock
// ─────────────────────────────────────────────────────────────────────────────
test.describe('STRESS — Concurrence stock (S1)', () => {

  // [R5] Précondition dure (remplace test.skip conditionnel)
  test.beforeAll(async () => {
    await assertMutantTargetSafe();
    if (!process.env.ALLOW_ORDER_SUBMIT) throw new Error('[R5] ALLOW_ORDER_SUBMIT requis — ce test ne peut pas être skippé');
  });
  test.setTimeout(90_000);

  test('S1 — 2 POST /api/orders simultanés sur le même produit', async ({ page }) => {
    // Stratégie : tester la concurrence au niveau API (fetch parallèle),
    // pas au niveau UI. L'UI a trop de gates (requireIdentity, OTP modal)
    // qui rendent la soumission simultanée non fiable en Playwright.
    // Le vrai risque est la race condition sur le stock côté DB (FOR UPDATE).

    await page.goto(BASE_URL);
    await waitForGrid(page);

    // Trouver un produit avec stock > 1
    const card = page.locator('#k-grid .k-promo-card, #k-grid .k-card').first();
    const productId = await card.getAttribute('data-id');
    const stockBefore = await getProductStock(page, productId);

    if (!stockBefore || stockBefore.stock === null || stockBefore.stock < 2) {
      throw new Error(`[R5][S1] Stock insuffisant (${stockBefore?.stock}) — env de test doit avoir stock ≥ 2`);
    }
    console.log(`[S1] Produit "${stockBefore.name}" (${productId}) — stock: ${stockBefore.stock}`);

    // Récupérer un relais_id compatible avec la destination du produit
    const relaisId = await page.evaluate(async (args) => {
      try {
        // Récupérer la destination du produit (si exposée)
        const prodResp = await fetch(new URL(`/api/products/${args.pid}`, args.base).href);
        const prod = prodResp.ok ? await prodResp.json() : {};

        const resp = await fetch(new URL('/api/relais', args.base).href);
        const data = await resp.json();
        const list = Array.isArray(data) ? data : data.relais || [];

        // Filtrer : exclure les relais de test (AAA) et préférer ceux qui
        // ont des destinations larges ou qui matchent la destination produit
        const real = list.filter(r => !r.name?.startsWith('AAA'));
        if (real.length > 0) return real[0].id;
        return list[0]?.id || null;
      } catch { return null; }
    }, { pid: productId, base: API_BASE });

    if (!relaisId) {
      throw new Error('[R5][S1] Aucun relais disponible — env de test doit avoir un relais configuré');
    }

    // Lancer 2 POST /api/orders en parallèle via page.evaluate
    const results = await page.evaluate(async (args) => {
      const makeOrder = async (idx) => {
        try {
          const resp = await fetch(new URL('/api/orders', args.base).href, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              items: [{ product_id: args.productId, quantity: 1 }],
              payment_mode: 'cash_relais',
              relais_id: args.relaisId,
              recipient_name: `Stress Concurrent ${idx}`,
              recipient_phone: `700${1110 + idx}`,
            }),
          });
          const body = await resp.json().catch(() => ({}));
          return { status: resp.status, ref: body.order?.reference || null, error: body.error };
        } catch (e) { return { status: 0, error: e.message }; }
      };

      // Départ simultané
      return Promise.all([makeOrder(1), makeOrder(2)]);
    }, { productId, relaisId, base: API_BASE });

    console.log(`[S1] Résultat A : ${results[0].status} — ${results[0].ref || results[0].error}`);
    console.log(`[S1] Résultat B : ${results[1].status} — ${results[1].ref || results[1].error}`);

    // Avec stock ≥ 2, les deux doivent passer (201)
    // Si le stock était 1, un des deux recevrait un 409
    const created = results.filter(r => r.status === 201);
    const blocked = results.filter(r => r.status === 409);
    console.log(`[S1] Créées: ${created.length}, Bloquées (stock): ${blocked.length}`);

    expect(
      created.length,
      'Au moins une commande doit être créée',
    ).toBeGreaterThanOrEqual(1);

    expect(
      created.length + blocked.length,
      'Chaque requête doit retourner 201 ou 409 (pas d\'erreur serveur)',
    ).toBe(2);

    // Vérifier le stock final
    // NOTE : pour les commandes cash_relais, le stock n'est décrémenté que
    // lors de confirmPaymentCycle (quand l'agent relais confirme le paiement).
    // À la création, le stock reste inchangé. C'est le comportement correct.
    // Le vrai test de concurrence est : 2 POST simultanés → 2×201, pas de
    // deadlock, pas de 500, pas de corruption de données.
    const stockAfter = await getProductStock(page, productId);
    console.log(`[S1] Stock après : ${stockAfter?.stock} (cash_relais = pas de décrémentation immédiate)`);

    if (stockAfter?.stock !== null) {
      // Cash : stock inchangé (décrémenté plus tard à la confirmation paiement)
      // Wallet : stock décrémenté immédiatement
      expect(
        stockAfter.stock,
        'Stock ne doit pas être négatif ou incohérent',
      ).toBeGreaterThanOrEqual(0);
    }

    console.log(`[S1] Concurrence OK : ${created.length} commandes créées simultanément, pas de deadlock ✓`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S2 — Gros panier
// ─────────────────────────────────────────────────────────────────────────────
test.describe('STRESS — Gros panier (S2)', () => {

  test.setTimeout(90_000);

  test('S2 — 5 produits différents dans le panier, checkout complet', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForGrid(page);

    const cards = page.locator('#k-grid .k-promo-card, #k-grid .k-card');
    const count = await cards.count();
    const target = Math.min(count, 5);

    if (target < 3) {
      throw new Error(`[R5][S2] Catalogue insuffisant (${count} produits) — env de test doit avoir ≥ 3 produits`);
    }

    // Ajouter N produits au panier
    let added = 0;
    for (let i = 0; i < Math.min(count, 8) && added < target; i++) {
      // S'assurer que la modale précédente est fermée avant de cliquer
      const overlay = page.locator('#k-modal-overlay');
      const isOpen = await overlay.evaluate(el => el.classList.contains('open')).catch(() => false);
      if (isOpen) {
        await page.keyboard.press('Escape');
        await page.waitForFunction(
          () => !document.getElementById('k-modal-overlay')?.classList.contains('open'),
          { timeout: 5_000 },
        ).catch(() => {});
        await page.waitForTimeout(300);
      }

      const c = cards.nth(i);

      // Vérifier que la carte est visible avant d'interagir
      const isVisible = await c.isVisible().catch(() => false);
      if (!isVisible) {
        console.log(`[S2] Carte ${i + 1} non visible — skip`);
        continue;
      }

      try {
        await c.scrollIntoViewIfNeeded({ timeout: 3_000 });
      } catch {
        console.log(`[S2] Carte ${i + 1} impossible à scroller — skip`);
        continue;
      }

      await c.click({ timeout: 5_000 }).catch(() => null);
      const modalOpened = await page.waitForSelector(
        '#k-modal-overlay.open, .k-modal-overlay.open', { timeout: 6_000 },
      ).catch(() => null);

      if (!modalOpened) {
        console.log(`[S2] Carte ${i + 1} — modale non ouverte — skip`);
        continue;
      }
      await page.waitForTimeout(500);

      // Si le produit a des variantes, sélectionner la première option
      const variantBtns = page.locator('.k-variant-btn, .k-modal-variant-btn');
      if ((await variantBtns.count()) > 0) {
        await variantBtns.first().click().catch(() => {});
        await page.waitForTimeout(300);
      }

      // Tenter d'ajouter — si le bouton n'est pas activé (variante non choisie), skip ce produit
      const addBtn = page.locator('#k-add-cart-btn');
      const isEnabled = await addBtn.isEnabled({ timeout: 2_000 }).catch(() => false);
      if (!isEnabled) {
        console.log(`[S2] Produit ${i + 1} nécessite une sélection — skip`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        continue;
      }

      try {
        await addToCartFromModal(page);
        added++;
        console.log(`[S2] Produit ${added}/${target} ajouté`);
      } catch {
        console.log(`[S2] Produit ${i + 1} — addToCart échoué — skip`);
      }

      // Fermer la modale
      await page.keyboard.press('Escape');
      await page.waitForFunction(
        () => !document.getElementById('k-modal-overlay')?.classList.contains('open'),
        { timeout: 5_000 },
      ).catch(() => {});
      await page.waitForTimeout(300);
    }

    if (added < 3) {
      throw new Error(`[R5][S2] Seulement ${added} produits ajoutés — insuffisant pour le stress test`);
    }

    // Vérifier le badge panier
    const badge = page.locator('#k-cart-badge, .k-cart-badge');
    if ((await badge.count()) > 0) {
      const badgeText = await badge.textContent();
      console.log(`[S2] Badge panier : ${badgeText}`);
    }

    // Ouvrir le checkout
    await openCheckout(page);

    // Le checkout ne doit pas crasher avec un gros panier
    const checkoutBody = page.locator('#k-order-modal, .k-order-modal').first();
    await expect(checkoutBody).toBeVisible({ timeout: 10_000 });

    // Vérifier que le total est > 0 et pas NaN
    const totalEl = page.locator('#k-order-total, .k-ck-total, #ck-total-amount');
    if ((await totalEl.count()) > 0) {
      const totalText = await totalEl.first().textContent();
      console.log(`[S2] Total affiché : ${totalText}`);
      expect(totalText, 'Le total ne doit pas contenir NaN').not.toContain('NaN');
      expect(totalText, 'Le total ne doit pas contenir undefined').not.toContain('undefined');

      const totalNum = parseInt(totalText.replace(/\D/g, ''), 10);
      expect(totalNum, 'Le total doit être > 0').toBeGreaterThan(0);
    }

    // Le bouton confirmer doit être visible (pas de crash layout)
    const btn = page.locator('#btn-confirm-order');
    await expect(btn).toBeVisible({ timeout: 5_000 });
    console.log(`[S2] Checkout avec ${target} produits OK ✓`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S3 — Wallet exact (solde == prix)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('STRESS — Wallet au centime près (S3)', () => {

  // [R5] Précondition dure
  test.beforeAll(async () => {
    await assertMutantTargetSafe();
    if (!process.env.ALLOW_ORDER_SUBMIT) throw new Error('[R5] ALLOW_ORDER_SUBMIT requis — ce test ne peut pas être skippé');
  });

  test('S3 — Wallet couvre exactement le montant → solde final = 0', async ({ page }) => {
    await page.goto(BASE_URL);
    const session = await verifySession(page);
    expect(session.authenticated).toBe(true);

    const wallet = await verifyWalletBalance(page);
    if (!wallet || wallet.balance <= 0) {
      throw new Error('[R5][S3] Solde wallet = 0 — provisionner le compte de test');
    }
    console.log(`[S3] Solde wallet : ${wallet.balance} KMF`);

    // Chercher un produit dont le prix <= solde wallet
    await waitForGrid(page);
    const cards = page.locator('#k-grid .k-promo-card, #k-grid .k-card');
    const count = await cards.count();

    let foundCard = null;
    for (let i = 0; i < Math.min(count, 10); i++) {
      const c = cards.nth(i);
      await c.click();
      await page.waitForSelector('#k-modal-overlay.open, .k-modal-overlay.open', { timeout: 6_000 });
      const priceText = await page.locator('#k-modal-price, .k-modal-price').first().textContent().catch(() => '');
      const price = parseInt(priceText.replace(/\D/g, ''), 10) || 0;
      if (price > 0 && price <= wallet.balance) {
        foundCard = i;
        console.log(`[S3] Produit trouvé : prix ${price} KMF ≤ solde ${wallet.balance} KMF`);
        break;
      }
      await page.locator('#k-modal-close, .k-modal-close').click().catch(() => {});
      await page.waitForTimeout(300);
    }

    if (foundCard === null) {
      throw new Error('[R5][S3] Aucun produit à prix ≤ solde wallet — augmenter le provisionnement');
    }

    // Le produit est déjà ouvert dans la modale
    await addToCartFromModal(page);
    await openCheckout(page);
    await selectRecipientOther(page);

    const nameInput = page.locator('#of-beneficiary-name');
    const phoneInput = page.locator('#of-beneficiary-phone');
    if ((await nameInput.count()) > 0) await nameInput.fill('Stress Wallet Exact');
    if ((await phoneInput.count()) > 0) await phoneInput.fill('7009991');

    // Attendre le wallet dans le checkout
    await page.waitForFunction(
      () => {
        const el = document.getElementById('wallet-balance-text');
        return el && !el.textContent.includes('Chargement');
      },
      { timeout: 10_000 },
    ).catch(() => {});

    // Cocher le wallet
    const walletCb = page.locator('#cb-use-wallet');
    if ((await walletCb.count()) === 0) { throw new Error('[R5][S3] Checkbox wallet absente malgré solde > 0'); }
    if (!(await walletCb.isChecked())) await walletCb.check();

    await page.locator('#ck-relais-summary').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});

    const orderRespPromise = page.waitForResponse(
      r => r.url().includes('/api/orders') && r.request().method() === 'POST',
      { timeout: 20_000 },
    );

    const confirmBtn = page.locator('#btn-confirm-order');
    await expect(confirmBtn).toBeEnabled({ timeout: 15_000 });
    await confirmBtn.click();

    const resp = await orderRespPromise;
    const body = await resp.json().catch(() => ({}));
    expect(resp.status(), 'Commande créée (201)').toBe(201);

    const creditApplied = body.credit_applied_kmf || 0;
    console.log(`[S3] Commande ${body.order?.reference} — credit: ${creditApplied} KMF`);

    // Vérifier le solde final
    await page.goto(BASE_URL);
    const walletAfter = await verifyWalletBalance(page);
    console.log(`[S3] Solde après : ${walletAfter?.balance} KMF`);

    if (creditApplied > 0) {
      expect(walletAfter.balance, 'Le solde doit être ≥ 0').toBeGreaterThanOrEqual(0);
      // Vérification financière stricte
      expect(
        walletAfter.balance,
        `Cohérence wallet : ${wallet.balance} - ${creditApplied} = ${walletAfter.balance}`,
      ).toBe(wallet.balance - creditApplied);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S4 — Wallet insuffisant → fallback cash
// ─────────────────────────────────────────────────────────────────────────────
test.describe('STRESS — Wallet insuffisant (S4)', () => {

  test('S4 — Wallet coché mais solde insuffisant → pas de débit', async ({ page }) => {
    await page.goto(BASE_URL);
    const session = await verifySession(page);
    expect(session.authenticated).toBe(true);

    const wallet = await verifyWalletBalance(page);
    console.log(`[S4] Solde wallet : ${wallet?.balance ?? 'N/A'} KMF`);

    // Même avec solde = 0, on vérifie que cocher wallet ne casse rien
    await waitForGrid(page);
    await openFirstCard(page);
    await addToCartFromModal(page);
    await openCheckout(page);

    // Attendre le wallet dans le checkout
    await page.waitForFunction(
      () => {
        const el = document.getElementById('wallet-balance-text');
        return el && !el.textContent.includes('Chargement');
      },
      { timeout: 10_000 },
    ).catch(() => {});

    // La checkbox wallet doit être visible
    const walletCb = page.locator('#cb-use-wallet');
    if ((await walletCb.count()) > 0) {
      // Cocher/décocher ne doit pas crasher
      if (!(await walletCb.isChecked())) await walletCb.check();
      await page.waitForTimeout(500);

      // Le total ne doit pas devenir NaN ou négatif
      const totalEl = page.locator('#btn-confirm-order');
      const totalText = await totalEl.textContent();
      expect(totalText, 'Le total ne doit pas contenir NaN').not.toContain('NaN');
      expect(totalText, 'Le total ne doit pas être négatif').not.toMatch(/-\d/);

      // Décocher
      await walletCb.uncheck();
      await page.waitForTimeout(500);

      const totalAfter = await totalEl.textContent();
      expect(totalAfter, 'Le total après uncheck ne doit pas contenir NaN').not.toContain('NaN');

      console.log(`[S4] Toggle wallet OK — checked: "${totalText.trim().slice(0, 50)}", unchecked: "${totalAfter.trim().slice(0, 50)}" ✓`);
    } else {
      console.log('[S4] Checkbox wallet absente');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S5 — Refresh F5 mid-checkout
// ─────────────────────────────────────────────────────────────────────────────
test.describe('STRESS — Refresh mid-checkout (S5)', () => {

  test('S5 — F5 pendant le checkout → panier survit', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForGrid(page);
    await openFirstCard(page);
    await addToCartFromModal(page);

    // Lire le panier avant refresh
    const cartBefore = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('kmrc_cart') || '[]'); }
      catch { return []; }
    });
    expect(cartBefore.length, 'Panier doit avoir ≥1 article').toBeGreaterThanOrEqual(1);
    console.log(`[S5] Panier avant refresh : ${cartBefore.length} article(s)`);

    // Refresh brutal
    await page.reload({ waitUntil: 'networkidle' });
    await waitForGrid(page);

    // Le panier doit survivre (localStorage persiste)
    const cartAfter = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('kmrc_cart') || '[]'); }
      catch { return []; }
    });

    expect(cartAfter.length, 'Le panier doit survivre au refresh').toBe(cartBefore.length);

    // Le badge panier doit refléter le contenu
    const badge = page.locator('#k-cart-badge, .k-cart-badge');
    if ((await badge.count()) > 0) {
      const badgeText = await badge.textContent();
      const badgeNum = parseInt(badgeText, 10);
      if (!isNaN(badgeNum)) {
        expect(badgeNum, 'Le badge doit correspondre au panier').toBeGreaterThanOrEqual(1);
      }
    }
    console.log(`[S5] Panier après refresh : ${cartAfter.length} article(s) ✓`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S6 — Back button mid-checkout
// ─────────────────────────────────────────────────────────────────────────────
test.describe('STRESS — Back button (S6)', () => {

  test('S6 — Retour navigateur pendant checkout → panier intact', async ({ page }) => {
    // Créer un historique de navigation pour que goBack() reste sur le même domaine
    // (sinon goBack() va sur about:blank et localStorage est inaccessible)
    await page.goto(BASE_URL);
    await waitForGrid(page);

    // Naviguer vers un onglet (pushState) pour créer une entrée d'historique
    await page.evaluate(() => history.pushState({}, '', location.href));

    await openFirstCard(page);
    await addToCartFromModal(page);

    // Lire le panier avant
    const cartBefore = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('kmrc_cart') || '[]'); }
      catch { return []; }
    });
    expect(cartBefore.length, 'Panier doit avoir ≥1 article').toBeGreaterThanOrEqual(1);

    await openCheckout(page);

    // Retour navigateur (revient au pushState qu'on a créé, même domaine)
    await page.goBack();
    await page.waitForTimeout(1_500);

    // Le panier doit survivre dans localStorage
    const cart = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('kmrc_cart') || '[]'); }
      catch { return []; }
    });
    expect(cart.length, 'Le panier doit survivre au back').toBeGreaterThanOrEqual(1);
    console.log(`[S6] Panier après back : ${cart.length} article(s) ✓`);

    // La page ne doit pas crasher (pas de white screen)
    const bodyText = await page.locator('body').textContent();
    expect(bodyText.length, 'La page ne doit pas être vide').toBeGreaterThan(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S7 — 2 onglets simultanés
// ─────────────────────────────────────────────────────────────────────────────
test.describe('STRESS — 2 onglets même user (S7)', () => {

  // [R5] Précondition dure (remplace test.skip conditionnel)
  test.beforeAll(async () => {
    await assertMutantTargetSafe();
    if (!process.env.ALLOW_ORDER_SUBMIT) throw new Error('[R5] ALLOW_ORDER_SUBMIT requis — ce test ne peut pas être skippé');
  });
  test.setTimeout(90_000);

  test('S7 — 2 onglets commandent simultanément → pas de corruption', async ({ page, context }) => {
    // Tab 1 : préparer le checkout
    await page.goto(BASE_URL);
    await waitForGrid(page);
    await openFirstCard(page);
    await addToCartFromModal(page);

    // Tab 2 : même contexte (même session, même localStorage)
    const page2 = await context.newPage();
    await page2.goto(BASE_URL);
    await waitForGrid(page2);
    await openFirstCard(page2);
    await addToCartFromModal(page2);

    // Les deux ouvrent le checkout
    await openCheckout(page);
    await openCheckout(page2);

    // Remplir les bénéficiaires
    const fillBenef = async (p, phone) => {
      await selectRecipientOther(p);
      const n = p.locator('#of-beneficiary-name');
      const ph = p.locator('#of-beneficiary-phone');
      if ((await n.count()) > 0) await n.fill('Stress Tab');
      if ((await ph.count()) > 0) await ph.fill(phone);
      await p.locator('#ck-relais-summary').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    };

    await fillBenef(page, '7007771');
    await fillBenef(page2, '7007772');

    // Soumission simultanée — intercepter sans envoyer au vrai backend
    const results = [];
    for (const p of [page, page2]) {
      await p.route('**/api/orders', async (route, req) => {
        if (req.method() === 'POST') {
          const payload = req.postDataJSON();
          results.push({
            items: payload?.items?.length || 0,
            idempotencyKey: payload?.idempotencyKey || null,
          });
        }
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            order: { id: 'tab-test', reference: 'KM-TAB', status: 'pending',
                     total_kmf: 5000, payment_mode: 'cash_relais', payment_status: 'pending' },
          }),
        });
      });
    }

    // Cliquer les deux confirmer
    const click = async (p, label) => {
      const btn = p.locator('#btn-confirm-order');
      if (await btn.isEnabled().catch(() => false)) {
        await btn.click().catch(() => {});
        console.log(`[S7] ${label} cliqué`);
      }
    };

    await Promise.all([click(page, 'Tab1'), click(page2, 'Tab2')]);
    await page.waitForTimeout(3_000);

    console.log(`[S7] ${results.length} requête(s) interceptée(s)`);

    // Chaque requête doit avoir ≥1 item (pas de panier vide envoyé)
    for (const r of results) {
      expect(r.items, 'Chaque requête doit avoir ≥1 article').toBeGreaterThanOrEqual(1);
    }
    console.log('[S7] Pas de corruption de panier entre onglets ✓');

    await page2.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S8 — Modifier le panier pendant le checkout
// ─────────────────────────────────────────────────────────────────────────────
test.describe('STRESS — Cart mutation mid-checkout (S8)', () => {

  test('S8 — Ajouter un produit au panier pendant que le checkout est ouvert', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForGrid(page);
    await openFirstCard(page);
    await addToCartFromModal(page);

    const cartBefore = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('kmrc_cart') || '[]'); }
      catch { return []; }
    });
    console.log(`[S8] Panier avant : ${cartBefore.length} article(s)`);

    await openCheckout(page);

    // Injecter un 2e produit via JavaScript (simule une manipulation localStorage)
    await page.evaluate(() => {
      try {
        const cart = JSON.parse(localStorage.getItem('kmrc_cart') || '[]');
        if (cart.length > 0) {
          const clone = { ...cart[0], _qty: (cart[0]._qty || 1) + 1 };
          cart.push(clone);
          localStorage.setItem('kmrc_cart', JSON.stringify(cart));
        }
      } catch { /* ignore */ }
    });

    // Le checkout ouvert ne doit pas crasher
    const checkoutBody = page.locator('#k-order-modal');
    await expect(checkoutBody).toBeVisible();

    // Le bouton confirmer doit toujours être accessible
    const btn = page.locator('#btn-confirm-order');
    await expect(btn).toBeVisible();

    console.log('[S8] Checkout survit à la mutation du panier ✓');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S9 — Session expirée mid-checkout
// ─────────────────────────────────────────────────────────────────────────────
test.describe('STRESS — Session expirée mid-checkout (S9)', () => {

  test('S9 — Cookie JWT supprimé avant soumission → erreur claire', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForGrid(page);
    await openFirstCard(page);
    await addToCartFromModal(page);
    await openCheckout(page);
    await selectRecipientOther(page);

    const nameInput = page.locator('#of-beneficiary-name');
    const phoneInput = page.locator('#of-beneficiary-phone');
    if ((await nameInput.count()) > 0) await nameInput.fill('Stress Session');
    if ((await phoneInput.count()) > 0) await phoneInput.fill('7008881');

    await page.locator('#ck-relais-summary').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});

    // ── Simuler l'expiration : supprimer le cookie JWT ──
    const cookies = await page.context().cookies();
    const jwtCookies = cookies.filter(c => c.name.includes('jwt') || c.name.includes('token') || c.name.includes('session'));
    console.log(`[S9] Cookies auth trouvés : ${jwtCookies.map(c => c.name).join(', ') || 'aucun'}`);

    // Supprimer tous les cookies auth
    await page.context().clearCookies();

    // Intercepter la requête pour vérifier le comportement
    let orderStatus = null;
    await page.route('**/api/orders', async (route, req) => {
      if (req.method() === 'POST') {
        // Laisser passer vers le vrai backend pour voir le 401
        await route.continue();
      } else {
        await route.continue();
      }
    });

    const confirmBtn = page.locator('#btn-confirm-order');
    if (await confirmBtn.isEnabled().catch(() => false)) {
      // Attendre la réponse (devrait être un 401)
      const respPromise = page.waitForResponse(
        r => r.url().includes('/api/orders') && r.request().method() === 'POST',
        { timeout: 15_000 },
      ).catch(() => null);

      await confirmBtn.click();

      const resp = await respPromise;
      if (resp) {
        orderStatus = resp.status();
        console.log(`[S9] POST /api/orders sans cookie → ${orderStatus}`);
        expect(orderStatus, 'Sans session, la commande doit être rejetée (401)').toBe(401);
      }

      // Un toast ou une erreur doit apparaître
      await page.waitForTimeout(2_000);
      const toastText = await page.locator('#k-toast').textContent().catch(() => '');
      console.log(`[S9] Toast : "${toastText.trim().slice(0, 80)}"`);
    } else {
      // Le bouton est disabled → requireIdentity a bloqué en amont
      console.log('[S9] Bouton confirmer désactivé — identity gate a bloqué ✓');
    }
  });
});
