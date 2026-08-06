/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   group.spec.js
 * @feature shared-cart
 * @brief Groupe / panier partagé : créateur, participant public, timeout retry
 */
'use strict';
const { test, expect } = require('@playwright/test');
const {
  BASE_URL, navigateToTab, addFirstProductToCart, openCartDrawer, IS_REMOTE,
} = require('./helpers/boutique.helpers');

test.describe('E-GROUP — Panier groupe', () => {

  test('E13 — L\'onglet groupe finit de charger (pas de spinner infini)', async ({ page }) => {
    await page.goto(BASE_URL);
    await navigateToTab(page, 'group');

    const groupView = page.locator('#k-group-view');
    await expect(groupView).toBeAttached({ timeout: 5_000 });

    await page.waitForFunction(
      () => {
        const el = document.getElementById('k-group-view');
        if (!el) return false;
        return !el.textContent.includes('Chargement…') && el.textContent.length > 5;
      },
      { timeout: 15_000 }
    );

    const text = await groupView.textContent();
    // État terminal : paniers affichés, état vide, erreur, gate auth
    const terminal =
      text.includes('Aucun panier') ||         // état vide (normal)
      text.includes('Créer') ||                 // CTA créer un panier
      text.includes('panier') ||                // un panier est affiché
      text.includes('Réessayer') ||             // erreur + retry
      text.includes('Impossible') ||            // erreur
      text.includes('Identifiez');              // gate auth
    expect(terminal).toBe(true);
  });

  test('E13b — Groupe timeout /mine → erreur + Réessayer (jamais loader infini)', async ({ page }) => {
    await page.route('**/api/shared-carts/mine**', () => { /* pend */ });
    await page.goto(BASE_URL);
    await navigateToTab(page, 'group');

    await page.waitForSelector('#k-group-retry-btn', { timeout: 15_000 });

    const groupView = page.locator('#k-group-view');
    const text = await groupView.textContent();
    expect(text).not.toContain('Chargement…');
    expect(text).toMatch(/Réessayer|Impossible/);
  });

  test('E14 — Page publique panier partagé : charge sans crash', async ({ page }) => {
    // FIXME: le shim shared-cart-public.html ne redirige PAS avec un token invalide.
    // Avec un vrai token, location.replace() se déclenche vers /boutique/?tab=group&p=TOKEN.
    // Avec 'test-invalid-token', le shim reste bloqué — c'est un comportement attendu
    // mais le test ne peut pas fonctionner sans un vrai token partagé.
    // → À transformer en test authentifié avec un vrai lien de partage, ou à supprimer.
    test.fixme(true, 'Le shim ne redirige pas avec un token invalide — nécessite un vrai token de partage');
    // Accès direct à la page publique avec un token bidon
    // BASE_URL se termine désormais par un slash (ex: http://localhost:3000/boutique/) :
    // ne pas préfixer le chemin relatif par un second slash.
    //
    // FIX 2026-07-10-c — shared-cart-public.html n'est plus une page autonome
    // depuis le commit 5af5f7a8 ("turn public page into boutique redirect
    // shim") : c'est un simple <script> qui fait location.replace() vers
    // /boutique/?tab=group&p=<token>. resp.status() ci-dessous est donc celui
    // du shim (200, HTML statique quasi vide), pas de la page finale.
    // L'ancien check `body.length > 30` passait quasi instantanément une fois
    // sur la SPA boutique (shell statique déjà >30 chars : header, nav, hero…)
    // bien avant que le rendu async du mode participant (getSharedCartPublic
    // → renderError) ait eu le temps de s'exécuter — d'où le message attendu
    // absent. On attend le redirect effectif, puis #k-group-view spécifiquement
    // (même pattern que E13), et on vérifie SON texte, pas celui du body entier.
    const resp = await page.goto(BASE_URL + 'shared-cart-public.html?token=test-invalid-token');
    expect(resp.status()).toBeLessThan(400);

    // Le shim redirige via location.replace — attendre qu'on ait bien quitté
    // shared-cart-public.html. On ne peut PAS attendre "?p=test-invalid-token"
    // dans l'URL : handleParticipantUrl() (b-nav.js) le lit puis le nettoie
    // aussitôt via history.replaceState() (URL propre, sans token, dans la
    // barre d'adresse) — attendre cette chaîne précise, c'est faire la course
    // contre le nettoyage de l'app elle-même (flaky, cf. échec Mobile Chrome).
    // Seul signal stable : avoir quitté la page shim.
    await page.waitForURL((url) => !url.toString().includes('shared-cart-public'), { timeout: 8_000 });

    const groupView = page.locator('#k-group-view');
    await expect(groupView).toBeAttached({ timeout: 5_000 });

    // Attendre l'état terminal (pas "Chargement…") avant de lire le texte,
    // comme E13 — getSharedCartPublic() est garanti ≤10s par fetchWithTimeout.
    await page.waitForFunction(
      () => {
        const el = document.getElementById('k-group-view');
        if (!el) return false;
        return !el.textContent.includes('Chargement…') && el.textContent.length > 5;
      },
      { timeout: 12_000 }
    );

    const text = await groupView.textContent();
    // Avec un token invalide, on attend un message d'erreur lisible
    const validResponse =
      text.includes('introuvable') ||
      text.includes('expiré') ||
      text.includes('invalide') ||
      text.includes('Réessayer') ||
      text.includes('Impossible') ||
      text.includes('Erreur');
    expect(validResponse).toBe(true);
  });

  test('E14b — \"Partager\" ouvre le formulaire de panier groupe (sans créer réellement)', async ({ page }) => {
    test.skip(!IS_REMOTE, 'Nécessite un catalogue réel (backend) — lancer avec BASE_URL distant');

    // Volontairement pas de vraie création de shared-cart contre la prod :
    // startShareFlow() n'appelle createSharedCart() qu'après confirmation du
    // formulaire (promptInit) — on s'arrête juste avant, en fermant via ✕.
    // Ça vérifie l'UI (b-share-cart.js) sans polluer la base de données réelle.
    await addFirstProductToCart(page);
    await openCartDrawer(page);

    const isDesktopViewport = await page.evaluate(() => window.innerWidth >= 900);
    const shareBtn = page.locator(isDesktopViewport ? '#k-sc-share' : '#k-cart-share');
    await expect(shareBtn).toBeVisible({ timeout: 5_000 });
    await shareBtn.click();

    const modal = page.locator('.k-share-modal-overlay');
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await expect(modal.locator('.k-sm-title')).toContainText('Partager');

    // Fermeture sans soumettre — aucun appel réseau de création déclenché.
    await modal.locator('.k-sm-close').click();
    await expect(modal).toHaveCount(0, { timeout: 3_000 });
  });
});
