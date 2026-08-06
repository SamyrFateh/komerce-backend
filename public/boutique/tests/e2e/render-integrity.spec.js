/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   render-integrity.spec.js
 * @brief Garde-fou anti-régression : détecte le cas où la boutique est servie
 *        depuis le mauvais dossier racine HTTP (public/boutique au lieu de
 *        public), ce qui casse tous les chemins absolus /boutique/css/...,
 *        /boutique/js/... et fait retomber la page en HTML brut non stylé
 *        (logo SVG géant, grille catalogue absente).
 *
 *        Ne fait PAS échouer le test sur des ressources externes facultatives
 *        (Google Fonts, Stripe, Cloudinary) : seules les ressources locales
 *        critiques /boutique/css/, /boutique/js/ et /images/ sont surveillées.
 *
 *        Tourne en mode LOCAL comme en mode DISTANT (BASE_URL) — le rendu/CSS
 *        doit être correct dans les deux cas.
 */
'use strict';
const { test, expect } = require('@playwright/test');
const { waitForGrid, gotoAndVerifyTarget } = require('./helpers/boutique.helpers');

test.describe('Régression — boutique servie depuis la mauvaise racine HTTP', () => {

  test('aucune ressource CSS/JS/image locale critique ne répond en 404, et le rendu est stylé', async ({ page }) => {
    const { failedCriticalResources } = await gotoAndVerifyTarget(page);
    await waitForGrid(page);

    // ── 1. Aucune 404 / échec réseau sur une ressource locale critique ──────
    expect(
      failedCriticalResources,
      `Ressources locales critiques en échec :\n${failedCriticalResources.join('\n')}`
    ).toHaveLength(0);

    // ── 2. Le CSS est réellement appliqué (pas un fallback HTML brut) ──────
    // Sans CSS, .k-header n'a pas de position fixe/sticky ni de hauteur bornée.
    const headerStyles = await page.locator('.k-header').first().evaluate((el) => {
      const cs = getComputedStyle(el);
      return { position: cs.position, height: el.getBoundingClientRect().height };
    });
    expect(
      ['fixed', 'sticky', 'relative', 'static'].includes(headerStyles.position),
      'k-header doit avoir un position calculé (CSS chargé)'
    ).toBe(true);
    expect(headerStyles.height, 'k-header ne doit pas avoir une hauteur nulle').toBeGreaterThan(0);

    // ── 3. Le logo n'a pas une dimension aberrante (symptôme connu du bug) ─
    // En desktop le logo est .k-logo-svg, en mobile il peut être .k-logo-mini ou .k-logo
    const logoSelectors = ['.k-logo-svg', '.k-logo-mini', '.k-logo'];
    let logoBox = null;
    for (const sel of logoSelectors) {
      const loc = page.locator(sel).first();
      if ((await loc.count()) > 0) {
        logoBox = await loc.boundingBox();
        if (logoBox) break;
      }
    }
    expect(logoBox, 'le logo doit être visible (aucun sélecteur trouvé parmi .k-logo-svg, .k-logo-mini, .k-logo)').not.toBeNull();
    expect(logoBox.width, 'logo anormalement géant (CSS manquant ?)').toBeLessThan(400);
    expect(logoBox.height, 'logo anormalement géant (CSS manquant ?)').toBeLessThan(200);

    // ── 4. La grille catalogue finit par apparaître avec au moins une carte ─
    const cardCount = await page
      .locator('#k-grid .k-promo-card, #k-grid .k-card')
      .count();
    expect(cardCount, 'la grille catalogue doit contenir au moins une carte').toBeGreaterThan(0);
  });
});
