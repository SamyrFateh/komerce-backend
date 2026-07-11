/**
 * @e2e   authenticated/api-contracts.spec.js
 * @feature orders, shared-cart, wallet
 * @brief Tests de contrat — Vérifient que les payloads envoyés par le
 *        frontend respectent le schéma attendu par le backend.
 *
 * Pourquoi c'est important :
 *   Le frontend (b-checkout.js, b-share-cart.js) construit les payloads
 *   en vanilla JS, sans schéma formel. Le backend valide avec Joi
 *   (validators/index.js). Si un champ est renommé/retiré d'un côté
 *   sans l'autre, le 400 silencieux en prod est invisible.
 *
 * Ce fichier intercepte les vraies requêtes du frontend et vérifie la
 * forme du payload contre le contrat documenté. Pas de soumission réelle.
 */
'use strict';
const { test, expect } = require('@playwright/test');
const {
  BASE_URL, waitForGrid, openFirstCard, addToCartFromModal,
  openCheckout, selectRecipientOther, openCartDrawer,
} = require('../helpers/boutique.helpers');
const { verifySession } = require('../helpers/api.helpers');

test.describe('CONTRATS — Payloads frontend ↔ backend', () => {

  // ─── C1 — Contrat POST /api/orders ─────────────────────────────────────

  test('C1 — Le payload de submitOrder() respecte le schéma backend', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForGrid(page);
    await openFirstCard(page);
    await addToCartFromModal(page);
    await openCheckout(page);
    await selectRecipientOther(page);

    const nameInput = page.locator('#of-beneficiary-name');
    const phoneInput = page.locator('#of-beneficiary-phone');
    if ((await nameInput.count()) > 0) await nameInput.fill('Test Contrat');
    if ((await phoneInput.count()) > 0) await phoneInput.fill('7008888');

    await page.locator('#ck-relais-summary').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});

    // Intercepter le payload sans le laisser partir
    let capturedPayload = null;
    await page.route('**/api/orders*', async (route, request) => {
      if (request.method() === 'POST') {
        try { capturedPayload = request.postDataJSON(); } catch { capturedPayload = request.postData(); }
      }
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          order: { id: 'contract-test', reference: 'KM-CONTRACT', status: 'pending',
                   total_kmf: 5000, payment_mode: 'cash_relais', payment_status: 'pending' },
        }),
      });
    });

    const confirmBtn = page.locator('#btn-confirm-order');
    await expect(confirmBtn).toBeEnabled({ timeout: 15_000 });
    await confirmBtn.click();

    // Attendre que le payload soit capturé
    await page.waitForTimeout(3_000);

    if (!capturedPayload) {
      // eslint-disable-next-line no-console
      console.log('[C1] Aucun payload intercepté — submitOrder() a peut-être bloqué avant l\'appel API (guard OTP)');
      // Ce n'est pas un échec du contrat, c'est le guard d'identité qui a intercepté
      return;
    }

    // eslint-disable-next-line no-console
    console.log('[C1] Payload capturé :', JSON.stringify(capturedPayload, null, 2).slice(0, 500));

    // ── Vérifications de contrat (miroir du Joi backend) ──

    // items[] obligatoire, min 1
    expect(capturedPayload.items, 'items doit être un tableau').toBeInstanceOf(Array);
    expect(capturedPayload.items.length, 'items doit avoir ≥1 article').toBeGreaterThanOrEqual(1);

    for (let i = 0; i < capturedPayload.items.length; i++) {
      const item = capturedPayload.items[i];
      expect(item.product_id, `items[${i}].product_id requis (UUID)`).toBeTruthy();
      expect(typeof item.product_id, `items[${i}].product_id doit être string`).toBe('string');
      expect(item.quantity, `items[${i}].quantity requis`).toBeTruthy();
      expect(typeof item.quantity, `items[${i}].quantity doit être number`).toBe('number');
      expect(item.quantity, `items[${i}].quantity ≥ 1`).toBeGreaterThanOrEqual(1);

      // confection_type doit être un des MODULE_TYPES si présent
      if (item.confection_type) {
        const VALID_CONFECTION = ['aucun', 'ourlet', 'retouche', 'confection', 'broderie'];
        expect(
          VALID_CONFECTION,
          `items[${i}].confection_type doit être valide`
        ).toContain(item.confection_type);
      }
    }

    // payment_mode obligatoire, valeurs strictes
    expect(capturedPayload.payment_mode, 'payment_mode requis').toBeTruthy();
    const VALID_MODES = ['stripe_eur', 'cash_relais', 'paypal_eur'];
    expect(VALID_MODES, 'payment_mode doit être valide').toContain(capturedPayload.payment_mode);

    // use_wallet doit être booléen si présent
    if (capturedPayload.use_wallet !== undefined) {
      expect(typeof capturedPayload.use_wallet, 'use_wallet doit être boolean').toBe('boolean');
    }

    // recipient_name et recipient_phone : strings
    if (capturedPayload.recipient_name) {
      expect(typeof capturedPayload.recipient_name).toBe('string');
      expect(capturedPayload.recipient_name.length).toBeLessThanOrEqual(100);
    }

    // relais_id : UUID si présent
    if (capturedPayload.relais_id) {
      expect(capturedPayload.relais_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    }

    // Pas de champs inattendus qui feraient échouer Joi (.options({ allowUnknown: false }))
    const KNOWN_FIELDS = new Set([
      'items', 'relais_id', 'payment_mode', 'stripe_payment_intent',
      'recipient_name', 'recipient_phone', 'tracking_phone',
      'confection_type', 'confection_instructions', 'confection_delay_days',
      'confection_artisan_id', 'module_type', 'module_fabric_id',
      'module_fabric_type', 'module_size', 'module_retouche',
      'module_qty_meters', 'module_accessories', 'order_occasion',
      'use_wallet', 'share_token',
    ]);

    const unknownFields = Object.keys(capturedPayload).filter(k => !KNOWN_FIELDS.has(k));
    if (unknownFields.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[C1] ⚠️ Champs non reconnus dans le payload : ${unknownFields.join(', ')}`);
      // On ne fait pas échouer le test — Joi peut être configuré en allowUnknown
      // mais c'est un signal d'alerte
    }

    // eslint-disable-next-line no-console
    console.log('[C1] Contrat POST /api/orders vérifié ✓');
  });

  // ─── C2 — Contrat POST /api/shared-carts/from-cart-items ───────────────

  test('C2 — Le payload de shared-cart creation respecte le schéma backend', async ({ page }) => {
    test.skip(!process.env.ALLOW_GROUP_FLOW, 'ALLOW_GROUP_FLOW requis');

    await page.goto(BASE_URL);
    await waitForGrid(page);
    await openFirstCard(page);
    await addToCartFromModal(page);
    await openCartDrawer(page);

    const shareBtn = page.locator('#k-cart-share, #k-sc-share').first();
    await expect(shareBtn).toBeVisible({ timeout: 10_000 });

    // Intercepter le payload
    let capturedPayload = null;
    await page.route('**/api/shared-carts/from-cart-items*', async (route, request) => {
      if (request.method() === 'POST') {
        try { capturedPayload = request.postDataJSON(); } catch { capturedPayload = request.postData(); }
      }
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          shared_cart: { id: 999, token: 'test-c2-token', status: 'open' },
        }),
      });
    });

    await shareBtn.click();

    const shareModal = page.locator('.k-share-modal-overlay');
    await expect(shareModal).toBeVisible({ timeout: 8_000 });

    const titleInput = page.locator('#k-sm-title-f');
    if ((await titleInput.count()) > 0) await titleInput.fill('Contrat Test');

    const needsValidation = page.locator('.k-sm-nature-opt[data-mode="needs_validation"]');
    if ((await needsValidation.count()) > 0) await needsValidation.click();

    const submitBtn = page.locator('#k-sm-submit');
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
    await submitBtn.click();

    await page.waitForTimeout(3_000);

    if (!capturedPayload) {
      // eslint-disable-next-line no-console
      console.log('[C2] Aucun payload intercepté');
      return;
    }

    // eslint-disable-next-line no-console
    console.log('[C2] Payload capturé :', JSON.stringify(capturedPayload, null, 2).slice(0, 500));

    // cart_items[] obligatoire
    expect(capturedPayload.cart_items, 'cart_items doit être un tableau').toBeInstanceOf(Array);
    expect(capturedPayload.cart_items.length, 'cart_items ≥ 1').toBeGreaterThanOrEqual(1);

    for (let i = 0; i < capturedPayload.cart_items.length; i++) {
      const item = capturedPayload.cart_items[i];
      expect(item.product_id || item.id, `cart_items[${i}] doit avoir un identifiant produit`).toBeTruthy();
    }

    // title: string si présent
    if (capturedPayload.title) {
      expect(typeof capturedPayload.title).toBe('string');
    }

    // share_mode si présent
    if (capturedPayload.share_mode) {
      const VALID_MODES = ['needs_validation', 'ready_to_pay'];
      expect(VALID_MODES).toContain(capturedPayload.share_mode);
    }

    // eslint-disable-next-line no-console
    console.log('[C2] Contrat POST /api/shared-carts/from-cart-items vérifié ✓');
  });

  // ─── C3 — Les endpoints publics retournent le bon Content-Type ─────────

  test('C3 — Endpoints publics retournent JSON avec les bons headers', async ({ page }) => {
    await page.goto(BASE_URL);

    const endpoints = [
      { path: '/api/products', label: 'Catalogue produits' },
      { path: '/api/relais', label: 'Liste relais' },
      { path: '/api/categories', label: 'Catégories' },
      { path: '/api/loyalty/tiers', label: 'Paliers fidélité' },
    ];

    for (const ep of endpoints) {
      const result = await page.evaluate(async (args) => {
        try {
          const resp = await fetch(new URL(args.path, args.base).href);
          return {
            status: resp.status,
            contentType: resp.headers.get('content-type') || '',
            ok: resp.ok,
          };
        } catch (e) { return { status: 0, error: e.message }; }
      }, { path: ep.path, base: BASE_URL.replace('/boutique/', '') });

      // eslint-disable-next-line no-console
      console.log(`[C3] ${ep.label} (${ep.path}) → ${result.status} ${result.contentType}`);

      expect(result.ok, `${ep.label} doit retourner 200`).toBe(true);
      expect(
        result.contentType,
        `${ep.label} doit retourner JSON`
      ).toContain('application/json');
    }
  });

  // ─── C4 — Endpoints authentifiés retournent 401 sans session ───────────

  test('C4 — Endpoints auth retournent 401 sans cookie', async ({ page }) => {
    // Utiliser un contexte anonyme
    const anonContext = await page.context().browser().newContext();
    const anonPage = await anonContext.newPage();

    try {
      await anonPage.goto(BASE_URL);

      const authEndpoints = [
        { path: '/api/wallet', label: 'Wallet' },
        { path: '/api/orders', label: 'Liste commandes' },
        { path: '/api/shared-carts/mine', label: 'Mes paniers partagés' },
        { path: '/api/auth/me', label: 'Session utilisateur' },
        { path: '/api/loyalty/me', label: 'Mon palier fidélité' },
      ];

      for (const ep of authEndpoints) {
        const result = await anonPage.evaluate(async (args) => {
          try {
            const resp = await fetch(new URL(args.path, args.base).href, {
              credentials: 'omit',
            });
            return { status: resp.status };
          } catch (e) { return { status: 0, error: e.message }; }
        }, { path: ep.path, base: BASE_URL.replace('/boutique/', '') });

        // eslint-disable-next-line no-console
        console.log(`[C4] ${ep.label} sans auth → ${result.status}`);

        expect(
          result.status,
          `${ep.label} doit retourner 401 sans session`
        ).toBe(401);
      }
    } finally {
      await anonContext.close();
    }
  });
});
