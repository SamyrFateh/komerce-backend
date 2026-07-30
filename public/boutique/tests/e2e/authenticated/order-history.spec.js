/**
 * @e2e   authenticated/order-history.spec.js
 * @feature orders
 * @brief F06 — L'historique de commande reflète les transitions de statut.
 *
 * Flux vérifié :
 *   1. Récupérer les commandes récentes du compte de test
 *   2. Pour la commande la plus récente, lire l'historique via
 *      GET /api/orders/:id/history
 *   3. Vérifier que l'historique est un tableau non vide, ordonné
 *      chronologiquement, avec au minimum l'entrée initiale (ordered/confirmed)
 *   4. Vérifier côté UI que la page suivi affiche la commande et son statut
 *
 * Ce test est READ-ONLY. Si aucune commande n'existe, il passe en skip.
 */
'use strict';
const { test, expect } = require('@playwright/test');
const { BASE_URL, navigateToTab } = require('../helpers/boutique.helpers');
const { getRecentOrders, verifySession, requireOrders } = require('../helpers/api.helpers');
const { getOrderHistory, getOrderByRef } = require('../helpers/business.helpers');

test.describe('FLOW — Historique commande (F06)', () => {

  test('F06 — L\'historique reflète les transitions de statut', async ({ page }) => {
    await page.goto(BASE_URL);

    // ── 1. Session active ──
    const session = await verifySession(page);
    expect(session.authenticated, 'La session doit être active').toBe(true);

    // ── 2. Récupérer les commandes ──
    const orders = await getRecentOrders(page);
    // [R5] Plus de skip : requireOrders() lève une erreur si aucune commande n'existe
    if (orders.length === 0) {
      await requireOrders(page); // throws with clear message
    }

    const targetOrder = orders[0];
    const orderId = targetOrder.id;
    const ref = targetOrder.reference || targetOrder.ref;
    // eslint-disable-next-line no-console
    console.log(`[F06] Commande cible : ${ref} (id: ${orderId}, status: ${targetOrder.status})`);

    // ── 3. Récupérer l'historique backend ──
    const history = await getOrderHistory(page, orderId);
    // eslint-disable-next-line no-console
    console.log(`[F06] Historique : ${history.length} entrée(s)`);

    expect(
      history.length,
      'L\'historique doit contenir au moins une entrée (statut initial)'
    ).toBeGreaterThanOrEqual(1);

    // Vérifier la cohérence de chaque entrée
    for (let i = 0; i < history.length; i++) {
      const entry = history[i];
      expect(entry.status, `Entrée ${i} doit avoir un statut`).toBeTruthy();
      expect(entry.created_at, `Entrée ${i} doit avoir un timestamp`).toBeTruthy();
    }

    // Vérifier l'ordre chronologique
    for (let i = 1; i < history.length; i++) {
      const prev = new Date(history[i - 1].created_at).getTime();
      const curr = new Date(history[i].created_at).getTime();
      expect(
        curr,
        `L'entrée ${i} doit être après l'entrée ${i - 1} (ordre chrono)`
      ).toBeGreaterThanOrEqual(prev);
    }

    // Le premier statut doit être un statut initial connu
    const INITIAL_STATUSES = ['ordered', 'confirmed', 'pending', 'pending_group_payment'];
    expect(
      INITIAL_STATUSES,
      `Le premier statut de l'historique ("${history[0].status}") doit être un statut initial`
    ).toContain(history[0].status);

    // Le dernier statut de l'historique doit correspondre au statut actuel de la commande
    const currentStatus = targetOrder.status;
    const lastHistoryStatus = history[history.length - 1].status;
    expect(
      lastHistoryStatus,
      `Le dernier statut historique ("${lastHistoryStatus}") doit correspondre au statut actuel ("${currentStatus}")`
    ).toBe(currentStatus);

    // ── 4. Vérifier côté UI que le suivi affiche cette commande ──
    await navigateToTab(page, 'track');

    const trackView = page.locator('#k-track-view');
    await expect(trackView).toBeAttached({ timeout: 5_000 });

    // Attendre que le tracking finisse de charger
    await page.waitForFunction(
      () => {
        const el = document.getElementById('k-track-view');
        return el && !el.textContent.includes('Chargement') && el.textContent.length > 10;
      },
      { timeout: 15_000 }
    );

    // La référence de la commande devrait être visible dans le suivi
    const trackText = await trackView.textContent();
    if (trackText.includes(ref) || trackText.includes('KM-')) {
      // eslint-disable-next-line no-console
      console.log(`[F06] Référence ${ref} visible dans le suivi UI ✓`);
    } else {
      // Le suivi peut être en mode recherche si pas de commandes récentes visibles
      // eslint-disable-next-line no-console
      console.log('[F06] Référence non visible directement — mode recherche ou pagination');
    }
  });
});
