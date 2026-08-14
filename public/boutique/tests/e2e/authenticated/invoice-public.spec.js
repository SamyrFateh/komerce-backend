/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   authenticated/invoice-public.spec.js
 * @feature orders, documents
 * @brief F05 — La facture est téléchargeable uniquement dans la session cliente.
 *
 * Flux vérifié :
 *   1. Lister les documents du compte (GET /api/auth/me/documents)
 *   2. Télécharger une facture avec la session et vérifier le PDF
 *   3. Vérifier que la même URL est refusée dans un contexte anonyme
 *
 * Ce test est READ-ONLY. Si aucune commande payée n'existe sur le compte de
 * test, le test passe en skip — il ne force pas de paiement.
 *
 * Pour un test garanti, enchaîner F02 (commande wallet 100%) puis F05.
 */
'use strict';
const { test, expect } = require('@playwright/test');
const { BASE_URL } = require('../helpers/boutique.helpers');
const { verifySession } = require('../helpers/api.helpers');
const { getPrivateDocuments, downloadPrivateDocument } = require('../helpers/business.helpers');

test.describe('FLOW — Facture privée dans Mon Komerce (F05)', () => {

  test('F05 — téléchargement PDF authentifié et refus anonyme', async ({ page }) => {
    await page.goto(BASE_URL);

    // ── 1. Vérifier la session ──
    const session = await verifySession(page);
    expect(session.authenticated, 'La session doit être active').toBe(true);

    // ── 2. Lister les documents du compte ──
    const listed = await getPrivateDocuments(page);
    expect(listed.status).toBe(200);
    const invoice = listed.documents.find((doc) => doc.document_type === 'invoice');
    if (!invoice) {
      // eslint-disable-next-line no-console
      console.log('[F05] Aucune facture disponible — skip (enchaîner F02 d\'abord pour tester)');
      test.skip();
      return;
    }

    // ── 3. Télécharger avec la session ──
    const privateResult = await downloadPrivateDocument(page, invoice.download_url);
    expect(privateResult.status).toBe(200);
    expect(privateResult.contentType).toContain('application/pdf');
    expect(privateResult.bytes).toBeGreaterThan(500);

    // ── 4. La même URL ne fonctionne pas sans session ──
    const anonContext = await page.context().browser().newContext();
    const anonPage = await anonContext.newPage();

    try {
      const anonymousResult = await downloadPrivateDocument(anonPage, invoice.download_url);
      expect([401, 403]).toContain(anonymousResult.status);
    } finally {
      await anonContext.close();
    }
  });
});
