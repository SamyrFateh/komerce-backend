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
 *      (le GET matérialise le PDF à la demande si le snapshot est encore pending)
 *   3. Vérifier que la même URL est refusée dans un contexte anonyme
 *
 * Ce test ne crée ni commande ni paiement. La seule écriture possible est la
 * matérialisation idempotente du PDF par la route privée de téléchargement.
 * Si aucune facture n'existe sur le compte de test, le test passe en skip.
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

    const invoices = listed.documents.filter((doc) => doc.document_type === 'invoice');
    if (invoices.length === 0) {
      // eslint-disable-next-line no-console
      console.log('[F05] Aucune facture listée — skip');
      test.skip();
      return;
    }

    // Contrat #907 : l'URL privée existe dès le snapshot facture, même si le
    // PDF n'est pas encore matérialisé (status=pending). Le premier GET protégé
    // appelle ensurePdf() et rend ensuite application/pdf.
    const invoice = invoices.find(
      (doc) =>
        typeof doc.download_url === 'string' &&
        doc.download_url.startsWith('/api/auth/me/documents/') &&
        doc.download_url.endsWith('/download')
    );

    expect(
      invoice,
      `${invoices.length} facture(s) listée(s) mais aucune n'expose l'URL privée canonique`
    ).toBeTruthy();

    // eslint-disable-next-line no-console
    console.log(`[F05] Facture ${invoice.reference || invoice.id} — status initial: ${invoice.status}`);

    // ── 3. Télécharger avec la session ──
    const privateResult = await downloadPrivateDocument(page, invoice.download_url);
    expect(privateResult.status).toBe(200);
    expect(privateResult.contentType).toContain('application/pdf');
    expect(privateResult.bytes).toBeGreaterThan(500);

    // ── 4. La même URL ne fonctionne pas sans session ──
    // On utilise l'API request du BrowserContext, pas une page : cela élimine
    // CORS, scripts Boutique, localStorage et service workers du diagnostic.
    const anonContext = await page.context().browser().newContext();

    try {
      // Défense explicite : ce contexte ne doit porter aucun cookie de session.
      await anonContext.clearCookies();
      expect(await anonContext.cookies(), 'Le contexte anonyme doit être sans cookie').toHaveLength(0);

      const downloadAbsoluteUrl = new URL(invoice.download_url, BASE_URL).href;
      const anonymousResponse = await anonContext.request.get(downloadAbsoluteUrl, {
        maxRedirects: 0,
      });

      // eslint-disable-next-line no-console
      console.log(`[F05] Accès anonyme à la facture → ${anonymousResponse.status()}`);
      expect([401, 403]).toContain(anonymousResponse.status());
    } finally {
      await anonContext.close();
    }
  });
});
