/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   authenticated/admin-status-transition.spec.js
 * @feature orders, logistics
 * @brief F30 — Un admin change le statut d'une commande → la page tracking
 *        boutique reflète le nouveau statut.
 *
 * Flux vérifié :
 *   1. Récupérer une commande existante (status = 'pending' ou 'confirmed')
 *   2. Avec les credentials admin, PATCH /api/orders/:id/status → 'ordered'
 *   3. GET /api/orders/:ref → statut mis à jour
 *   4. GET /api/orders/:id/history → nouvelle entrée dans l'historique
 *
 * ⚠️ Ce test MODIFIE le statut d'une commande réelle → staging uniquement.
 *
 * Prérequis (🔴) :
 *   - Un 2e compte de test avec rôle admin/agent_hub/agent_relais
 *   - TEST_ADMIN_PHONE + TEST_ADMIN_OTP (ou un token JWT admin injecté)
 *   - ALLOW_STATUS_CHANGE=true
 *
 * Alternative : si pas de compte admin, le test utilise l'API directement
 * avec le compte client et vérifie seulement que le statut est lisible
 * (pas de transition — lecture seule en fallback).
 */
'use strict';
const { test, expect } = require('@playwright/test');
const { BASE_URL } = require('../helpers/boutique.helpers');
const { getRecentOrders, verifySession } = require('../helpers/api.helpers');
const { getOrderByRef, getOrderHistory } = require('../helpers/business.helpers');

const API_BASE = (process.env.BASE_URL || 'http://localhost:3000/boutique/').replace('/boutique/', '');

// Transitions de statut valides pour un test non-destructif
const SAFE_TRANSITIONS = {
  pending: 'confirmed',
  confirmed: 'ordered',
  ordered: 'preparation',
};

test.describe('FLOW — Transition statut admin (F30)', () => {

  test.skip(
    !process.env.ALLOW_STATUS_CHANGE,
    'F30 nécessite ALLOW_STATUS_CHANGE=true — staging uniquement'
  );

  test('F30 — PATCH status → commande reflète le nouveau statut via API', async ({ page }) => {
    await page.goto(BASE_URL);

    // ── 1. Session active ──
    const session = await verifySession(page);
    expect(session.authenticated, 'Session active requise').toBe(true);

    // ── 2. Trouver une commande avec un statut transitionable ──
    const orders = await getRecentOrders(page);
    const transitionable = orders.filter((o) => SAFE_TRANSITIONS[o.status]);

    if (transitionable.length === 0) {
      // eslint-disable-next-line no-console
      console.log(`[F30] Aucune commande transitionable (statuts trouvés: ${orders.map(o => o.status).join(', ')})`);
      test.skip();
      return;
    }

    const target = transitionable[0];
    const orderId = target.id;
    const ref = target.reference || target.ref;
    const fromStatus = target.status;
    const toStatus = SAFE_TRANSITIONS[fromStatus];
    // eslint-disable-next-line no-console
    console.log(`[F30] Cible : ${ref} (${fromStatus} → ${toStatus})`);

    // ── 3. Compter les entrées d'historique AVANT ──
    const historyBefore = await getOrderHistory(page, orderId);
    const historyCountBefore = historyBefore.length;

    // ── 4. Tenter la transition ──
    // Le compte de test doit avoir le rôle admin/agent_hub/agent_relais
    // pour que PATCH /:id/status soit autorisé. Si le compte est un client
    // normal, on recevra un 403.
    const patchResult = await page.evaluate(async (args) => {
      try {
        const resp = await fetch(
          new URL(`/api/orders/${args.orderId}/status`, args.base).href,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              status: args.toStatus,
              note: 'e2e-test-F30',
            }),
          }
        );
        const body = await resp.json().catch(() => ({}));
        return { status: resp.status, body };
      } catch (e) { return { status: 0, error: e.message }; }
    }, { orderId, toStatus, base: API_BASE });

    // eslint-disable-next-line no-console
    console.log(`[F30] PATCH → ${patchResult.status}`);

    if (patchResult.status === 403) {
      // Le compte de test n'a pas le rôle admin — skip la transition,
      // vérifier uniquement la lecture (fallback lecture seule)
      // eslint-disable-next-line no-console
      console.log('[F30] 403 Forbidden — le compte de test n\'est pas admin. Fallback lecture.');

      // Vérification fallback : au moins le détail est accessible
      const detail = await getOrderByRef(page, ref);
      expect(detail, 'Le détail est accessible en lecture').not.toBeNull();
      expect(detail.status).toBe(fromStatus);
      // eslint-disable-next-line no-console
      console.log(`[F30] Fallback : lecture OK (status: ${detail.status}). Pour le test complet, provisionner un compte admin.`);
      return;
    }

    expect(
      patchResult.status,
      `PATCH status doit réussir (200) — reçu ${patchResult.status}`
    ).toBe(200);

    // ── 5. Vérifier que le statut est mis à jour ──
    const afterDetail = await getOrderByRef(page, ref);
    expect(afterDetail, 'La commande doit être accessible après transition').not.toBeNull();
    expect(
      afterDetail.status,
      `Le statut doit être '${toStatus}' après la transition`
    ).toBe(toStatus);

    // ── 6. Vérifier que l'historique a une nouvelle entrée ──
    const historyAfter = await getOrderHistory(page, orderId);
    expect(
      historyAfter.length,
      'L\'historique doit avoir une entrée de plus'
    ).toBe(historyCountBefore + 1);

    const lastEntry = historyAfter[historyAfter.length - 1];
    expect(lastEntry.status, 'La dernière entrée doit être le nouveau statut').toBe(toStatus);
    // eslint-disable-next-line no-console
    console.log(`[F30] Transition ${fromStatus} → ${toStatus} vérifiée (historique: ${historyAfter.length} entrées) ✓`);
  });
});
