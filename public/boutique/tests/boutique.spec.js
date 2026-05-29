/**
 * @file boutique.spec.js
 * @brief ARCH-7 — Tests Playwright · Flows critiques F1–F5
 *
 * Flows couverts :
 *   F1 — Ouverture modal produit depuis la grille
 *   F2 — Ajout au panier depuis la modal
 *   F3 — Navigation prev/next dans la modal
 *   F4 — Fermeture modal + retour scroll catalogue
 *   F5 — Chargement offline depuis cache localStorage
 *
 * Usage :
 *   npx playwright test tests/boutique.spec.js --headed
 *   npx playwright test tests/boutique.spec.js (headless)
 *
 * Prérequis :
 *   BASE_URL env var ou défaut http://localhost:3000
 *   npx playwright install chromium
 */

const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Attend que la grille catalogue soit hydratée (au moins une carte présente).
 */
async function waitForGrid(page) {
  await page.waitForSelector('#k-grid .k-promo-card, #k-grid .k-card', {
    timeout: 10_000,
  });
}

/**
 * Clique sur la première carte produit disponible et retourne son data-id.
 */
async function openFirstCard(page) {
  await waitForGrid(page);
  const card = page.locator('#k-grid .k-promo-card, #k-grid .k-card').first();
  const productId = await card.getAttribute('data-id');
  await card.click();
  return productId;
}

/**
 * Attend que la modal soit visible et affiche un produit (titre non vide).
 */
async function waitForModalOpen(page) {
  await page.waitForSelector('#k-modal-overlay.open, .k-modal-overlay.open', {
    timeout: 5_000,
  });
  await expect(page.locator('#k-modal-name')).not.toBeEmpty({ timeout: 5_000 });
}

// ─── F1 — Ouverture modal ───────────────────────────────────────────────────

test('F1 — Ouverture modal produit depuis la grille', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForGrid(page);

  // Récupère le data-id avant le clic
  const card = page.locator('#k-grid .k-promo-card, #k-grid .k-card').first();
  const productId = await card.getAttribute('data-id');
  expect(productId).toBeTruthy();

  await card.click();
  await waitForModalOpen(page);

  // La modal est ouverte
  await expect(page.locator('#k-modal-overlay')).toBeVisible();

  // Le titre du produit est renseigné
  const name = await page.locator('#k-modal-name').textContent();
  expect(name.trim().length).toBeGreaterThan(0);

  // Le prix est renseigné
  const price = await page.locator('#k-modal-price').textContent();
  expect(price.trim().length).toBeGreaterThan(0);

  // FIX F1 — Le carousel vide track.innerHTML et recrée des <img class="k-modal-slide">
  // dynamiquement : l'élément statique #k-modal-img perd son ID et n'est plus dans le DOM.
  // On cible donc le premier .k-modal-slide présent dans le carousel et on attend son src.
  await page.waitForFunction(
    () => {
      const img = document.querySelector('#k-modal-carousel .k-modal-slide');
      return img && img.src && img.src.length > 0;
    },
    { timeout: 5_000 }
  );
  const imgSrc = await page
    .locator('#k-modal-carousel .k-modal-slide')
    .first()
    .getAttribute('src');
  expect(imgSrc).toBeTruthy();

  // Le bouton fermeture est visible
  await expect(page.locator('#k-modal-close')).toBeVisible();
});

// ─── F2 — Ajout au panier depuis la modal ──────────────────────────────────

test('F2 — Ajout au panier depuis la modal', async ({ page }) => {
  await page.goto(BASE_URL);
  await openFirstCard(page);
  await waitForModalOpen(page);

  // Badge panier avant ajout
  const badgeBefore = await page.locator('#k-modal-cart-badge').textContent();
  const qtyBefore = parseInt(badgeBefore || '0', 10);

  // Stepper visible
  await expect(page.locator('#k-qty-val')).toBeVisible();
  const stepperVal = await page.locator('#k-qty-val').textContent();
  const qtyToAdd = parseInt(stepperVal || '1', 10);
  expect(qtyToAdd).toBeGreaterThan(0);

  // Clic sur Ajouter au panier
  const addBtn = page.locator('#k-add-cart-btn');
  await expect(addBtn).toBeEnabled({ timeout: 3_000 });
  await addBtn.click();

  // Le badge panier doit avoir augmenté
  await page.waitForFunction(
    ({ sel, before }) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const val = parseInt(el.textContent || '0', 10);
      return val > before;
    },
    { sel: '#k-modal-cart-badge', before: qtyBefore },
    { timeout: 5_000 }
  );

  const badgeAfter = await page.locator('#k-modal-cart-badge').textContent();
  const qtyAfter = parseInt(badgeAfter || '0', 10);
  expect(qtyAfter).toBeGreaterThan(qtyBefore);

  // Le bouton reflète l'état "dans le panier"
  const btnClass = await addBtn.getAttribute('class');
  expect(btnClass).toContain('in-cart');
});

// ─── F3 — Navigation prev/next dans la modal ──────────────────────────────

test('F3 — Navigation prev/next dans la modal', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForGrid(page);

  // Ouvre la deuxième carte pour pouvoir naviguer en arrière aussi
  const cards = page.locator('#k-grid .k-promo-card, #k-grid .k-card');
  const count = await cards.count();

  // Il faut au moins 2 produits pour tester la navigation
  expect(count).toBeGreaterThanOrEqual(2);

  const secondCard = cards.nth(1);
  const secondId = await secondCard.getAttribute('data-id');
  await secondCard.click();
  await waitForModalOpen(page);

  const nameSecond = await page.locator('#k-modal-name').textContent();

  // Bouton next doit exister (desktop l'injecte dynamiquement)
  // On vérifie la navigation via la modal back (catalogue → historique)
  // qui est disponible sur tous les viewports.

  // Ouvrir un autre produit depuis la modal suggestion ou navigation directe via bus
  // Alternative portable : vérifier que le back-label affiche "Catalogue" au premier produit
  const backLabel = await page.locator('#k-modal-back-label').textContent();
  expect(['Catalogue', 'Retour']).toContain(backLabel.trim());

  // Ferme et rouvre le premier produit, puis le second via next si dispo
  await page.locator('#k-modal-close').click();
  await expect(page.locator('#k-modal-overlay')).not.toHaveClass(/open/, {
    timeout: 3_000,
  });

  // Ouvre le premier produit
  const firstCard = cards.first();
  const firstId = await firstCard.getAttribute('data-id');
  await firstCard.click();
  await waitForModalOpen(page);

  const nameFirst = await page.locator('#k-modal-name').textContent();

  // Les deux produits ont bien des noms différents
  // (confirme que deux fiches distinctes s'ouvrent)
  expect(firstId).not.toBe(secondId);
  expect(nameFirst.trim()).toBeTruthy();
  expect(nameSecond.trim()).toBeTruthy();

  // Vérifie que state.modalHistory est vide (nouveau produit direct depuis grille)
  const historyEmpty = await page.evaluate(() => {
    try {
      // b-store expose state sur window en dev, sinon on lit le back-label
      const label = document.getElementById('k-modal-back-label');
      return label && label.textContent.trim() === 'Catalogue';
    } catch {
      return true;
    }
  });
  expect(historyEmpty).toBe(true);

  // Navigation next (desktop uniquement — injectée dynamiquement)
  const nextBtn = page.locator('#k-modal-next');
  const nextVisible = await nextBtn.isVisible().catch(() => false);

  if (nextVisible) {
    const notDisabled = !(await nextBtn.evaluate(
      el => el.classList.contains('is-disabled')
    ));
    if (notDisabled) {
      await nextBtn.click();
      await page.waitForFunction(
        name => {
          const el = document.getElementById('k-modal-name');
          return el && el.textContent.trim() !== name;
        },
        nameFirst,
        { timeout: 3_000 }
      );
      const nameAfterNext = await page.locator('#k-modal-name').textContent();
      expect(nameAfterNext.trim()).not.toBe(nameFirst.trim());

      // prev doit maintenant être actif
      const prevBtn = page.locator('#k-modal-prev');
      if (await prevBtn.isVisible()) {
        const prevDisabled = await prevBtn.evaluate(el =>
          el.classList.contains('is-disabled')
        );
        expect(prevDisabled).toBe(false);

        await prevBtn.click();
        await page.waitForFunction(
          name => {
            const el = document.getElementById('k-modal-name');
            return el && el.textContent.trim() === name;
          },
          nameFirst,
          { timeout: 3_000 }
        );
        const nameAfterPrev = await page.locator('#k-modal-name').textContent();
        expect(nameAfterPrev.trim()).toBe(nameFirst.trim());
      }
    }
  }
});

// ─── F4 — Fermeture modal + retour scroll catalogue ────────────────────────

test('F4 — Fermeture modal + retour scroll catalogue', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForGrid(page);

  // Scroll dans le catalogue avant d'ouvrir la modal
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(200); // laisse le temps au scroll de se stabiliser

  const scrollYBefore = await page.evaluate(() => window.scrollY || window.pageYOffset);

  await openFirstCard(page);
  await waitForModalOpen(page);

  // Le body doit avoir la classe modal-open (body lock)
  await expect(page.locator('body')).toHaveClass(/modal-open/, {
    timeout: 2_000,
  });

  // Fermeture via le bouton ✕
  await page.locator('#k-modal-close').click();

  // La modal doit disparaître
  await expect(page.locator('#k-modal-overlay')).not.toHaveClass(/open/, {
    timeout: 3_000,
  });

  // La classe modal-open doit être retirée du body
  await expect(page.locator('body')).not.toHaveClass(/modal-open/, {
    timeout: 2_000,
  });

  // La position de scroll doit être restaurée (± 50px de tolérance)
  await page.waitForTimeout(300); // laisse scrollToPosition() s'exécuter
  const scrollYAfter = await page.evaluate(() => window.scrollY || window.pageYOffset);
  expect(Math.abs(scrollYAfter - scrollYBefore)).toBeLessThanOrEqual(50);

  // FIX F4 — Fermeture via overlay (clic fond)
  // Le clic doit atterrir sur l'overlay lui-même et non sur un enfant (.k-modal).
  // On dispatch un MouseEvent directement sur l'élément overlay pour contourner
  // le problème de hit-testing (la modal couvre tout le viewport).
  await openFirstCard(page);
  await waitForModalOpen(page);

  await page.evaluate(() => {
    const overlay = document.getElementById('k-modal-overlay');
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await expect(page.locator('#k-modal-overlay')).not.toHaveClass(/open/, {
    timeout: 3_000,
  });

  // Fermeture via Escape
  await openFirstCard(page);
  await waitForModalOpen(page);

  await page.keyboard.press('Escape');
  await expect(page.locator('#k-modal-overlay')).not.toHaveClass(/open/, {
    timeout: 3_000,
  });
});

// ─── F5 — Chargement offline depuis cache localStorage ─────────────────────

test('F5 — Chargement offline depuis cache localStorage', async ({ page }) => {
  // Charge la page normalement pour hydrater le cache
  await page.goto(BASE_URL);
  await waitForGrid(page);

  // Vérifie que le cache a bien été écrit après le chargement API (BUG-C2)
  const cacheRaw = await page.evaluate(() =>
    localStorage.getItem('komerce_products_cache')
  );
  expect(cacheRaw).toBeTruthy();

  const cache = JSON.parse(cacheRaw);
  expect(Array.isArray(cache)).toBe(true);
  expect(cache.length).toBeGreaterThan(0);

  // Vérifie la structure minimale d'un produit dans le cache
  const first = cache[0];
  expect(first).toHaveProperty('id');
  expect(first).toHaveProperty('name');
  expect(first).toHaveProperty('price_kmf');

  // FIX F5 — Simule une panne API sans bloquer la navigation HTML.
  // On intercepte uniquement les requêtes XHR/fetch (non-document) vers l'API.
  // Le rechargement de la page HTML elle-même doit rester autorisé.
  await page.route('**/*', (route) => {
    const req = route.request();
    const type = req.resourceType();
    const url = req.url();

    // Laisser passer la navigation principale (document HTML)
    if (type === 'document') {
      return route.continue();
    }

    // Bloquer uniquement les appels API produits (fetch/xhr vers /api/ ou /products)
    if (
      type === 'fetch' || type === 'xhr'
    ) {
      const apiPatterns = ['/api/', '/products', '/komerce'];
      if (apiPatterns.some(p => url.includes(p))) {
        return route.abort();
      }
    }

    return route.continue();
  });

  // Recharge la page sans réseau API — waitUntil:'domcontentloaded' pour ne pas
  // attendre les ressources fetch qui sont intentionnellement bloquées.
  await page.reload({ waitUntil: 'domcontentloaded' });

  // La grille doit tout de même se remplir via le fallback cache
  await waitForGrid(page);

  const cardsCount = await page
    .locator('#k-grid .k-promo-card, #k-grid .k-card')
    .count();
  expect(cardsCount).toBeGreaterThan(0);

  // Ouvre une fiche pour s'assurer que les données offline sont exploitables
  await openFirstCard(page);
  await waitForModalOpen(page);

  const name = await page.locator('#k-modal-name').textContent();
  expect(name.trim().length).toBeGreaterThan(0);
});
