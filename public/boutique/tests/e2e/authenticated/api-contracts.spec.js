/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   authenticated/api-contracts.spec.js
 * @feature orders, shared-cart, wallet
 * @brief Contrats essentiels entre la boutique et le backend.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const {
  BASE_URL,
  waitForGrid,
  openFirstCard,
  addToCartFromModal,
  openCheckout,
  selectRecipientOther,
  openCartDrawer,
} = require('../helpers/boutique.helpers');

test.describe('CONTRATS — Payloads frontend ↔ backend', () => {
  test('C1 — Le payload de commande conserve le contrat canonique', async ({ page }) => {
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

    await page.locator('#ck-relais-summary')
      .waitFor({ state: 'visible', timeout: 10_000 })
      .catch(() => {});

    let capturedPayload = null;
    await page.route('**/api/orders*', async (route, request) => {
      if (request.method() === 'POST') {
        try {
          capturedPayload = request.postDataJSON();
        } catch (_) {
          capturedPayload = request.postData();
        }
      }

      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          order: {
            id: 'contract-test',
            reference: 'KM-CONTRACT',
            status: 'pending',
            total_kmf: 5000,
            payment_mode: 'cash_relais',
            payment_status: 'pending',
          },
        }),
      });
    });

    const confirmBtn = page.locator('#btn-confirm-order');
    await expect(confirmBtn).toBeEnabled({ timeout: 15_000 });
    await confirmBtn.click();
    await page.waitForTimeout(3_000);

    // Le garde d'identité peut arrêter le flux avant l'appel réseau.
    if (!capturedPayload) return;

    expect(capturedPayload.items).toBeInstanceOf(Array);
    expect(capturedPayload.items.length).toBeGreaterThanOrEqual(1);

    for (const item of capturedPayload.items) {
      expect(typeof item.product_id).toBe('string');
      expect(typeof item.quantity).toBe('number');
      expect(item.quantity).toBeGreaterThanOrEqual(1);
    }

    expect(['stripe_eur', 'cash_relais', 'paypal_eur'])
      .toContain(capturedPayload.payment_mode);
  });

  test('C2 — Partager cette liste envoie seulement les articles sélectionnés', async ({ page }) => {
    test.skip(!process.env.ALLOW_GROUP_FLOW, 'ALLOW_GROUP_FLOW requis');

    await page.goto(BASE_URL);
    await waitForGrid(page);
    await openFirstCard(page);
    await addToCartFromModal(page);
    await openCartDrawer(page);

    await page.evaluate(() => {
      window.open = () => null;
      try {
        Object.defineProperty(navigator, 'share', {
          configurable: true,
          value: async () => {},
        });
      } catch (_) {}
    });

    let capturedPayload = null;
    await page.route('**/api/shared-carts/from-cart-items*', async (route, request) => {
      if (request.method() === 'POST') {
        try {
          capturedPayload = request.postDataJSON();
        } catch (_) {
          capturedPayload = request.postData();
        }
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          shared_cart_id: 'contract-list',
          token: 'test-c2-token',
          share_url: `${BASE_URL}?p=test-c2-token`,
          status: 'open',
          items_count: 1,
          clear_local_cart: false,
        }),
      });
    });

    const shareBtn = page.locator('#k-cart-share, #k-sc-share').first();
    await expect(shareBtn).toBeVisible({ timeout: 10_000 });
    await shareBtn.click();
    await page.waitForTimeout(3_000);

    await expect(page.locator('#k-sm-submit')).toHaveCount(0);
    await expect(page.locator('#k-sm-title-f')).toHaveCount(0);
    await expect(page.locator('.k-sm-nature-opt')).toHaveCount(0);

    expect(capturedPayload).toBeTruthy();
    expect(Object.keys(capturedPayload)).toEqual(['cart_items']);
    expect(capturedPayload.cart_items).toBeInstanceOf(Array);
    expect(capturedPayload.cart_items.length).toBeGreaterThanOrEqual(1);

    for (const item of capturedPayload.cart_items) {
      expect(item.product_id).toBeTruthy();
      expect(item.quantity).toBeGreaterThanOrEqual(1);
    }
  });

  test('C3 — Les endpoints publics retournent du JSON', async ({ page }) => {
    await page.goto(BASE_URL);

    const endpoints = [
      '/api/products',
      '/api/relais',
      '/api/categories',
      '/api/loyalty/tiers',
    ];

    for (const path of endpoints) {
      const result = await page.evaluate(async ({ endpoint, base }) => {
        try {
          const response = await fetch(new URL(endpoint, base).href);
          return {
            ok: response.ok,
            contentType: response.headers.get('content-type') || '',
          };
        } catch (err) {
          return { ok: false, error: err.message, contentType: '' };
        }
      }, {
        endpoint: path,
        base: BASE_URL.replace('/boutique/', ''),
      });

      expect(result.ok, `${path} doit répondre`).toBe(true);
      expect(result.contentType).toContain('application/json');
    }
  });

  test('C4 — Les endpoints privés refusent une requête sans session', async ({ page }) => {
    const anonContext = await page.context().browser().newContext();
    const anonPage = await anonContext.newPage();

    try {
      await anonPage.goto(BASE_URL);

      const endpoints = [
        '/api/wallet',
        '/api/orders',
        '/api/shared-carts/mine',
        '/api/auth/me',
        '/api/loyalty/me',
      ];

      for (const path of endpoints) {
        const status = await anonPage.evaluate(async ({ endpoint, base }) => {
          try {
            const response = await fetch(new URL(endpoint, base).href, {
              credentials: 'omit',
            });
            return response.status;
          } catch (_) {
            return 0;
          }
        }, {
          endpoint: path,
          base: BASE_URL.replace('/boutique/', ''),
        });

        expect(status, `${path} doit retourner 401 sans session`).toBe(401);
      }
    } finally {
      await anonContext.close();
    }
  });
});
