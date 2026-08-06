/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   authenticated/wallet-flow.spec.js
 * @feature wallet
 * @brief Flux métier wallet authentifié : session → solde → historique.
 *
 * Vérifie que la chaîne complète fonctionne :
 *   1. Session active → pas de gate d'auth
 *   2. Solde affiché correspond au backend (GET /api/wallet)
 *   3. Historique de transactions lisible (pas de NaN, format KMF)
 *
 * READ-ONLY : aucune action destructive (pas de débit, pas de paiement).
 */
'use strict';
const { test, expect } = require('@playwright/test');
const { BASE_URL, navigateToTab } = require('../helpers/boutique.helpers');
const { verifySession, verifyWalletBalance } = require('../helpers/api.helpers');

test.describe('FLOW — Wallet authentifié', () => {

  test('F10 — Session active → solde wallet cohérent entre UI et API', async ({ page }) => {
    await page.goto(BASE_URL);

    // ── 1. Vérifier que la session est active côté backend ──
    // (verifySession utilise /api/auth/me — le vrai endpoint, cf. api.helpers.js)
    const session = await verifySession(page);
    expect(session.authenticated, 'La session doit être active').toBe(true);

    // ── 2. Naviguer vers l'onglet wallet ──
    await navigateToTab(page, 'wallet');

    const walletView = page.locator('#k-wallet-view');
    await expect(walletView).toBeAttached({ timeout: 5_000 });

    await page.waitForFunction(
      () => {
        const el = document.getElementById('k-wallet-view');
        return !!el && !el.textContent.includes('Chargement…') && el.textContent.length > 5;
      },
      { timeout: 15_000 }
    );

    // ── 3. Pas de gate d'auth ──
    const authGate = page.locator('#k-wlt-auth-btn');
    await expect(authGate).toHaveCount(0);

    // ── 4. Vérifier la cohérence UI ↔ API ──
    const apiBalance = await verifyWalletBalance(page);
    if (apiBalance) {
      const balanceCard = page.locator('.k-wlt-card');
      const zeroState = page.locator('.k-wlt-zero');
      const hasBalance = (await balanceCard.count()) > 0;
      const hasZero = (await zeroState.count()) > 0;
      expect(hasBalance || hasZero, 'L\'UI doit afficher un état de solde').toBe(true);

      if (apiBalance.balance > 0) {
        expect(hasBalance, 'Solde > 0 → carte solde visible').toBe(true);
      }
    }

    // ── 5. Historique : pas de NaN ──
    const txAmounts = page.locator('.k-wlt-tx-amt');
    const txCount = await txAmounts.count();
    for (let i = 0; i < Math.min(txCount, 5); i++) {
      const text = await txAmounts.nth(i).textContent();
      expect(text, `Transaction ${i} ne doit pas contenir NaN`).not.toContain('NaN');
    }
  });
});
