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
 *   2. Télécharger une facture disponible avec la session et vérifier le PDF
 *   3. Vérifier que la même URL est refusée dans un contexte anonyme
 *
 * Ce test est READ-ONLY. Si aucune facture disponible n'existe sur le compte
 * de test, le test passe en skip — il ne force pas de paiement ni de génération.
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

    // Le contrat documents ne fournit download_url que pour status=available.
    // Une facture pending n'est PAS un document téléchargeable et ne doit jamais
    // être passée au helper de téléchargement (new URL(null, base) viserait une
    // route HTML sans rapport avec le document et produirait un faux diagnostic).
    const invoice = listed.documents.find(
      (doc) =>
        doc.document_type === 'invoice' &&
        doc.status === 'available' &&
        typeof doc.download_url === 'string' &&
        doc.download_url.startsWith('/api/auth/me/documents/')
    );

    if (!invoice) {
      const invoiceCount = listed.documents.filter((doc) => doc.document_type === 'invoice').length;
      // eslint-disable-next-line no-console
      console.log(
        `[F05] ${invoiceCount} facture(s) listée(s), aucune disponible au téléchargement — skip ` +
        '(enchaîner F02 d\'abord pour tester)'
      );
      test.skip();
      return;
    }

    expect(invoice.download_url, 'Une facture available doit exposer download_url').toBeTruthy();

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
