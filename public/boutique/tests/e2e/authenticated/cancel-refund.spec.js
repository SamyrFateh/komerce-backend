/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   authenticated/cancel-refund.spec.js
 * @feature orders, refunds, wallet
 * @brief F03 — Annulation d'une commande payée → wallet re-crédité.
 *
 * Flux vérifié :
 *   1. Trouver une commande payée (payment_status === 'paid') annulable
 *      (status != collected, != refunded, != cancelled)
 *   2. Lire le solde wallet AVANT
 *   3. POST /api/orders/:id/cancel → statut 'cancelled'
 *   4. Vérifier : statut passé à 'cancelled'
 *   5. Vérifier : solde wallet ré-crédité (si wallet_applied_kmf > 0)
 *
 * ⚠️ Ce test ANNULE une commande réelle et CRÉDITE le wallet → staging uniquement.
 * Pour un scénario garanti, enchaîner F02 → F03 (F02 crée une commande payée
 * 100% wallet, F03 l'annule).
 *
 * Skip si aucune commande annulable n'est disponible.
 *
 * Prérequis (🔴) :
 *   - Au moins une commande payée sur le compte de test
 *   - ALLOW_ORDER_CANCEL=true (guard explicite)
 */
'use strict';
const { test, expect } = require('@playwright/test');
const { BASE_URL } = require('../helpers/boutique.helpers');
const { getRecentOrders, verifySession, verifyWalletBalance, assertMutantTargetSafe } = require('../helpers/api.helpers');
const { getOrderByRef } = require('../helpers/business.helpers');

const API_BASE = (process.env.BASE_URL || 'http://localhost:3000/boutique/').replace('/boutique/', '');

test.describe('FLOW — Annulation avec remboursement wallet (F03)', () => {

  // [R5] Précondition dure — throw si absent, pas de skip
  test.beforeAll(async () => {
    await assertMutantTargetSafe(); // [R5][FAIL-CLOSED]
    if (!process.env.ALLOW_ORDER_CANCEL) {
      throw new Error(
        '[R5] F03 nécessite ALLOW_ORDER_CANCEL=true — staging uniquement. ' +
        "Ce test ne peut pas être skippé : configurer l'environnement de test."
      );
    }
  });

  test('F03 — Annulation commande payée → wallet re-crédité', async ({ page }) => {
    await page.goto(BASE_URL);

    // ── 1. Session active ──
    const session = await verifySession(page);
    expect(session.authenticated, 'Session active requise').toBe(true);

    // ── 2. Trouver une commande annulable ──
    const orders = await getRecentOrders(page);
    const NON_CANCELLABLE = new Set(['collected', 'cancelled', 'refunded']);
    const cancellable = orders.filter(
      (o) =>
        (o.payment_status === 'paid' || o.payment_status === 'confirmed') &&
        !NON_CANCELLABLE.has(o.status)
    );

    if (cancellable.length === 0) {
      // eslint-disable-next-line no-console
      throw new Error(
        '[R5][F03] Aucune commande payée annulable — ' +
        'lancer F01/F02 d\'abord pour créer une commande payée, ou utiliser un compte de test pré-alimenté.'
      );
    }

    const target = cancellable[0];
    const orderId = target.id;
    const ref = target.reference || target.ref;
    // eslint-disable-next-line no-console
    console.log(`[F03] Cible : ${ref} (id: ${orderId}, status: ${target.status}, payment: ${target.payment_status})`);

    // ── 3. Lire le solde wallet AVANT l'annulation ──
    const walletBefore = await verifyWalletBalance(page);
    const balanceBefore = walletBefore?.balance ?? 0;
    // eslint-disable-next-line no-console
    console.log(`[F03] Solde wallet avant annulation : ${balanceBefore} KMF`);

    // Récupérer le détail pour connaître wallet_applied_kmf
    const detail = await getOrderByRef(page, ref);
    const walletApplied = detail?.wallet_applied_kmf || 0;
    // eslint-disable-next-line no-console
    console.log(`[F03] wallet_applied_kmf sur cette commande : ${walletApplied}`);

    // ── 4. Annuler la commande via l'API ──
    const cancelResult = await page.evaluate(async (args) => {
      try {
        const resp = await fetch(
          new URL(`/api/orders/${args.orderId}/cancel`, args.base).href,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ reason: 'e2e-test-F03' }),
          }
        );
        const body = await resp.json().catch(() => ({}));
        return { status: resp.status, body };
      } catch (e) { return { status: 0, error: e.message }; }
    }, { orderId, base: API_BASE });

    // eslint-disable-next-line no-console
    console.log(`[F03] POST cancel → status ${cancelResult.status}`);

    expect(
      cancelResult.status,
      `L'annulation doit réussir (200) — reçu ${cancelResult.status}: ${JSON.stringify(cancelResult.body)}`
    ).toBe(200);

    // ── 5. Vérifier le statut de la commande après annulation ──
    const afterDetail = await getOrderByRef(page, ref);
    expect(afterDetail, 'La commande doit toujours être accessible').not.toBeNull();
    expect(
      afterDetail.status,
      `Le statut doit être 'cancelled' après annulation (reçu: ${afterDetail.status})`
    ).toBe('cancelled');
    // eslint-disable-next-line no-console
    console.log(`[F03] Commande ${ref} → status: ${afterDetail.status} ✓`);

    // ── 6. Vérifier que le wallet a été re-crédité ──
    if (walletApplied > 0) {
      // Petit délai pour laisser le remboursement se propager (normalement synchrone
      // dans la transaction cancel, mais par sécurité)
      await page.waitForTimeout(1_000);

      const walletAfter = await verifyWalletBalance(page);
      const balanceAfter = walletAfter?.balance ?? 0;

      // eslint-disable-next-line no-console
      console.log(`[F03] Solde wallet après : ${balanceAfter} KMF (attendu: ${balanceBefore + walletApplied})`);

      // Le remboursement peut être total ou partiel selon la fenêtre de remboursement
      // (CANCEL_FREE_WINDOW_HOURS = 24h → 100%, sinon CANCEL_PARTIAL_REFUND_PCT = 80%)
      expect(
        balanceAfter,
        'Le solde wallet doit avoir augmenté après le remboursement'
      ).toBeGreaterThan(balanceBefore);

      // Vérification exacte si remboursement 100% attendu
      const expectedFull = balanceBefore + walletApplied;
      if (balanceAfter === expectedFull) {
        // eslint-disable-next-line no-console
        console.log(`[F03] Remboursement wallet 100% vérifié (${walletApplied} KMF) ✓`);
      } else {
        // Remboursement partiel (hors fenêtre)
        const refunded = balanceAfter - balanceBefore;
        // eslint-disable-next-line no-console
        console.log(`[F03] Remboursement partiel : ${refunded} KMF sur ${walletApplied} appliqué`);
      }
    } else {
      // eslint-disable-next-line no-console
      console.log('[F03] Pas de wallet appliqué sur cette commande — vérification solde non applicable');
    }
  });
});
