/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   authenticated/loyalty-tier.spec.js
 * @feature wallet-loyalty
 * @brief F12 (partiel) — Lecture du palier fidélité du compte de test et
 *        vérification de cohérence avec le nombre de commandes.
 *
 * Ce test NE DÉCLENCHE PAS de palier (pas de commande wallet gros panier).
 * Il vérifie :
 *   1. GET /api/loyalty/tiers → tableau de paliers (public)
 *   2. GET /api/loyalty/me → palier actuel du compte (auth)
 *   3. Cohérence : orders_count du compte → palier attendu selon tiers
 *   4. Si discount_pct > 0, vérifier que la boutique l'applique dans le catalogue
 *
 * READ-ONLY. Le test complet F12 (déclencher un palier) nécessite de connaître
 * les seuils et d'avoir un solde wallet suffisant.
 */
'use strict';
const { test, expect } = require('@playwright/test');
const { BASE_URL } = require('../helpers/boutique.helpers');
const { verifySession } = require('../helpers/api.helpers');

const API_BASE = (process.env.BASE_URL || 'http://localhost:3000/boutique/').replace('/boutique/', '');

test.describe('FLOW — Fidélité : palier et cohérence (F12 partiel)', () => {

  test('F12a — GET /api/loyalty/tiers retourne les paliers', async ({ page }) => {
    await page.goto(BASE_URL);

    const tiers = await page.evaluate(async (base) => {
      try {
        const resp = await fetch(new URL('/api/loyalty/tiers', base).href);
        if (!resp.ok) return { status: resp.status, data: null };
        return { status: resp.status, data: await resp.json() };
      } catch (e) { return { status: 0, error: e.message }; }
    }, API_BASE);

    // eslint-disable-next-line no-console
    console.log(`[F12a] GET /api/loyalty/tiers → ${tiers.status}`);

    expect(tiers.status, 'L\'endpoint tiers doit répondre 200').toBe(200);
    expect(Array.isArray(tiers.data), 'Les tiers doivent être un tableau').toBe(true);

    if (tiers.data.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[F12a] ${tiers.data.length} palier(s) configuré(s) :`);
      for (const tier of tiers.data) {
        expect(tier.label, 'Chaque palier doit avoir un label').toBeTruthy();
        expect(tier.min_orders, 'Chaque palier doit avoir un seuil min_orders').toBeDefined();
        expect(tier.discount_pct, 'Chaque palier doit avoir un discount_pct').toBeDefined();
        // eslint-disable-next-line no-console
        console.log(`  ${tier.badge || '•'} ${tier.label} — ≥${tier.min_orders} commandes → ${tier.discount_pct}%`);
      }

      // Vérifier l'ordre croissant par min_orders
      for (let i = 1; i < tiers.data.length; i++) {
        expect(
          tiers.data[i].min_orders,
          `Palier ${i} doit avoir un seuil ≥ palier ${i - 1}`
        ).toBeGreaterThanOrEqual(tiers.data[i - 1].min_orders);
      }
    } else {
      // eslint-disable-next-line no-console
      console.log('[F12a] Aucun palier configuré — la fidélité n\'est pas active');
    }
  });

  test('F12b — GET /api/loyalty/me retourne le palier du compte et est cohérent', async ({ page }) => {
    await page.goto(BASE_URL);

    const session = await verifySession(page);
    expect(session.authenticated, 'Session active requise').toBe(true);

    // Récupérer les tiers
    const tiers = await page.evaluate(async (base) => {
      try {
        const resp = await fetch(new URL('/api/loyalty/tiers', base).href);
        return resp.ok ? await resp.json() : [];
      } catch { return []; }
    }, API_BASE);

    // Récupérer le palier du compte
    const myLoyalty = await page.evaluate(async (base) => {
      try {
        const resp = await fetch(new URL('/api/loyalty/me', base).href, {
          credentials: 'include',
        });
        if (!resp.ok) return null;
        return await resp.json();
      } catch { return null; }
    }, API_BASE);

    expect(myLoyalty, 'GET /api/loyalty/me doit retourner un objet').not.toBeNull();

    // eslint-disable-next-line no-console
    console.log(`[F12b] Mon palier : orders_count=${myLoyalty.orders_count}, tier="${myLoyalty.tier_label}", discount=${myLoyalty.discount_pct}%`);

    // Vérifier la cohérence : le palier affiché doit correspondre au nombre de commandes
    if (tiers.length > 0 && myLoyalty.orders_count !== undefined) {
      const orderCount = myLoyalty.orders_count || 0;

      // Trouver le palier attendu selon les tiers
      let expectedTier = null;
      for (const tier of tiers) {
        if (orderCount >= tier.min_orders) {
          expectedTier = tier;
        }
      }

      if (expectedTier && myLoyalty.tier_label) {
        expect(
          myLoyalty.tier_label,
          `Avec ${orderCount} commandes, le palier devrait être "${expectedTier.label}"`
        ).toBe(expectedTier.label);

        expect(
          myLoyalty.discount_pct,
          `Le discount devrait être ${expectedTier.discount_pct}%`
        ).toBe(expectedTier.discount_pct);

        // eslint-disable-next-line no-console
        console.log(`[F12b] Cohérence vérifiée : ${orderCount} commandes → "${expectedTier.label}" (${expectedTier.discount_pct}%) ✓`);
      } else if (!expectedTier) {
        // Pas encore de palier atteint
        const nextTier = tiers[0];
        // eslint-disable-next-line no-console
        console.log(`[F12b] Aucun palier atteint (${orderCount} commandes, prochain à ${nextTier?.min_orders})`);
      }
    }

    // Vérifier que orders_count n'est pas négatif ou NaN
    if (myLoyalty.orders_count !== undefined) {
      expect(myLoyalty.orders_count).toBeGreaterThanOrEqual(0);
      expect(Number.isNaN(myLoyalty.orders_count)).toBe(false);
    }

    // discount_pct est null quand aucun palier n'est atteint (comportement attendu
    // de l'API) — on ne borne 0-100 que lorsque la valeur est un nombre.
    if (myLoyalty.discount_pct !== undefined && myLoyalty.discount_pct !== null) {
      expect(myLoyalty.discount_pct).toBeGreaterThanOrEqual(0);
      expect(myLoyalty.discount_pct).toBeLessThanOrEqual(100);
    } else if (myLoyalty.discount_pct === null) {
      // null est valide seulement si aucun palier n'est atteint (orders_count < min_orders du 1er tier)
      const orderCount = myLoyalty.orders_count || 0;
      const firstTier = tiers[0];
      if (firstTier) {
        expect(
          orderCount,
          `discount_pct=null n'est valide que si aucun palier n'est atteint (orders_count < ${firstTier.min_orders})`
        ).toBeLessThan(firstTier.min_orders);
      }
      // eslint-disable-next-line no-console
      console.log('[F12b] discount_pct=null cohérent : aucun palier atteint');
    }
  });
});
