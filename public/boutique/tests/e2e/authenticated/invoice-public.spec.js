/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   authenticated/invoice-public.spec.js
 * @feature orders, documents
 * @brief F05 — La facture publique est accessible sans auth après une commande payée.
 *
 * Flux vérifié :
 *   1. Récupérer les commandes récentes du compte de test (GET /api/orders)
 *   2. Pour chaque commande payée (payment_status === 'paid'), récupérer le
 *      détail via GET /api/orders/:ref qui contient le champ invoice_token
 *   3. Si un invoice_token existe, vérifier que GET /api/invoices/public/:token
 *      retourne 200 + contenu HTML (la facture rendue)
 *
 * Ce test est READ-ONLY. Si aucune commande payée n'existe sur le compte de
 * test, le test passe en skip — il ne force pas de paiement.
 *
 * Pour un test garanti, enchaîner F02 (commande wallet 100%) puis F05.
 */
'use strict';
const { test, expect } = require('@playwright/test');
const { BASE_URL } = require('../helpers/boutique.helpers');
const { getRecentOrders, verifySession } = require('../helpers/api.helpers');
const { getOrderByRef, fetchPublicInvoice } = require('../helpers/business.helpers');

test.describe('FLOW — Facture publique après commande (F05)', () => {

  test('F05 — Facture publique accessible via token sans auth', async ({ page }) => {
    await page.goto(BASE_URL);

    // ── 1. Vérifier la session ──
    const session = await verifySession(page);
    expect(session.authenticated, 'La session doit être active').toBe(true);

    // ── 2. Récupérer les commandes récentes ──
    const orders = await getRecentOrders(page);
    // eslint-disable-next-line no-console
    console.log(`[F05] ${orders.length} commande(s) trouvée(s) sur le compte de test`);

    // Filtrer les commandes payées (celles qui auraient une facture)
    const paidOrders = orders.filter(
      (o) => o.payment_status === 'paid' || o.payment_status === 'confirmed'
    );

    if (paidOrders.length === 0) {
      // eslint-disable-next-line no-console
      console.log('[F05] Aucune commande payée — skip (enchaîner F02 d\'abord pour tester)');
      test.skip();
      return;
    }

    // ── 3. Prendre la commande payée la plus récente ──
    const targetOrder = paidOrders[0];
    const ref = targetOrder.reference || targetOrder.ref;
    // eslint-disable-next-line no-console
    console.log(`[F05] Commande payée trouvée : ${ref} (status: ${targetOrder.payment_status})`);

    // ── 4. Récupérer le détail pour obtenir l'invoice_token ──
    const detail = await getOrderByRef(page, ref);
    expect(detail, `Le détail de la commande ${ref} doit être accessible`).not.toBeNull();

    const invoiceToken = detail.invoice_token || detail.invoiceToken;

    if (!invoiceToken) {
      // eslint-disable-next-line no-console
      console.log(`[F05] Pas d'invoice_token sur ${ref} — la facture n'a peut-être pas encore été générée`);
      // Vérifier au moins que le détail de la commande est cohérent
      expect(detail.reference || detail.ref).toBe(ref);
      test.skip();
      return;
    }

    // ── 5. Accéder à la facture publique SANS auth (nouveau contexte) ──
    // On crée un nouveau contexte sans cookies pour simuler un accès anonyme
    // (ex. lien WhatsApp cliqué par le destinataire)
    const anonContext = await page.context().browser().newContext();
    const anonPage = await anonContext.newPage();

    try {
      const result = await fetchPublicInvoice(anonPage, invoiceToken);
      // eslint-disable-next-line no-console
      console.log(`[F05] GET /api/invoices/public/${invoiceToken} → ${result.status} (${result.contentType})`);

      expect(result.status, 'La facture publique doit retourner 200').toBe(200);
      expect(result.hasContent, 'La facture doit avoir du contenu').toBe(true);
      expect(
        result.isHtml || result.isJson,
        'La facture doit être en HTML ou JSON'
      ).toBe(true);
    } finally {
      await anonContext.close();
    }
  });
});
