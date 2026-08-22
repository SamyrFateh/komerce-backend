'use strict';

/**
 * One-shot fail-closed patch.
 *
 * Purpose: make the shared Playwright addToCartFromModal() helper respect the
 * current Product Detail Contract. A SKU product is not purchase-ready until
 * one compatible AVAILABLE value has been selected for every unresolved axis.
 *
 * This script changes tests only. It must be deleted after execution.
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const target = path.join(
  repoRoot,
  'public', 'boutique', 'tests', 'e2e', 'helpers', 'boutique.helpers.js'
);

const before = `/** Ajoute le produit actuellement ouvert dans la modale au panier. */
async function addToCartFromModal(page) {
  const badgeBefore = parseInt(
    (await page.locator('#k-modal-cart-badge').textContent().catch(() => '0')) || '0',
    10
  );
  // Snapshot des éléments DOM existants avant le clic : assertNoOverlayOnActions
  // n'inspecte ensuite que les éléments réellement créés par l'action d'ajout
  // (ex. particule fly-to-cart), jamais le chrome permanent de la page (nav
  // mobile, pager, overlay) qui chevauche géométriquement la zone actions
  // sans être un défaut.
  await page.evaluate(() => {
    window.__preAddElements = new Set(document.querySelectorAll('body *'));
  });
  const addBtn = page.locator('#k-add-cart-btn');
  await expect(addBtn).toBeEnabled({ timeout: 3_000 });
  await addBtn.click();
  // Attend que le badge augmente
  await page.waitForFunction(
    ({ sel, before }) => {
      const el = document.querySelector(sel);
      return el && parseInt(el.textContent || '0', 10) > before;
    },
    { sel: '#k-modal-cart-badge', before: badgeBefore },
    { timeout: 6_000 }
  );
  // Attend la disparition réelle de la particule fly-to-cart (b-cart.js) —
  // un test/capture "état stable" pris avant cette disparition la verrait
  // encore visible au-dessus des actions.
  await page.waitForFunction(
    () => !document.querySelector('.k-fly-particle'),
    null,
    { timeout: 3_000 }
  );
}`;

const after = `/**
 * Résout une sélection SKU achetable dans la modale courante.
 *
 * Le contrat PDP expose chaque axe via [data-axis-key] et chaque valeur via
 * [data-option-value][data-option-state]. Desktop et mobile rerendent les axes
 * après chaque choix ; la sélection est donc effectuée directement dans le DOM
 * courant, un seul axe par passe, sans conserver de locator devenu obsolète.
 *
 * Aucun choix n'est inventé : seules les options explicitement AVAILABLE sont
 * cliquées. Si le contrat n'offre aucune combinaison achetable, le helper reste
 * fail-closed et le test demeure rouge.
 */
async function ensureModalPurchaseReady(page) {
  const addBtn = page.locator('#k-add-cart-btn');
  if (await addBtn.isEnabled().catch(() => false)) return;

  const axisCount = await page.locator('#k-modal-overlay [data-axis-key]').count();
  if (axisCount === 0) return;

  const maxSteps = Math.max(4, axisCount * 3);
  for (let step = 0; step < maxSteps; step += 1) {
    if (await addBtn.isEnabled().catch(() => false)) return;

    const clicked = await page.evaluate(() => {
      const axes = Array.from(
        document.querySelectorAll('#k-modal-overlay [data-axis-key]')
      );

      for (const axis of axes) {
        const activeAvailable = axis.querySelector(
          'button[data-option-state="AVAILABLE"][aria-pressed="true"]'
        );
        if (activeAvailable) continue;

        const available = axis.querySelector(
          'button[data-option-value][data-option-state="AVAILABLE"]'
        );
        if (!available) continue;

        available.click();
        return true;
      }
      return false;
    });

    if (!clicked) break;
  }

  if (await addBtn.isEnabled().catch(() => false)) return;

  const diagnostic = await page.evaluate(() => ({
    message: document.getElementById('k-modal-selection-message')?.textContent?.trim() || '',
    axes: Array.from(document.querySelectorAll('#k-modal-overlay [data-axis-key]')).map((axis) => ({
      key: axis.getAttribute('data-axis-key'),
      options: Array.from(axis.querySelectorAll('button[data-option-value]')).map((button) => ({
        value: button.getAttribute('data-option-value'),
        state: button.getAttribute('data-option-state'),
        selected: button.getAttribute('aria-pressed') === 'true',
      })),
    })),
  }));

  throw new Error(
    '[E2E] Produit non achetable après résolution des variantes : ' +
    JSON.stringify(diagnostic)
  );
}

/** Ajoute le produit actuellement ouvert dans la modale au panier. */
async function addToCartFromModal(page) {
  const addBtn = page.locator('#k-add-cart-btn');

  // Produit SIMPLE : CTA déjà actif. Produit SKU : suivre le contrat réel et
  // résoudre une combinaison disponible avant l'ajout.
  await ensureModalPurchaseReady(page);
  await expect(addBtn).toBeEnabled({ timeout: 5_000 });

  const badgeBefore = parseInt(
    (await page.locator('#k-modal-cart-badge').textContent().catch(() => '0')) || '0',
    10
  );

  // Snapshot de l'état stabilisé APRÈS la sélection éventuelle des variantes :
  // l'oracle d'overlay n'accuse ainsi que les éléments créés par l'ajout panier.
  await page.evaluate(() => {
    window.__preAddElements = new Set(document.querySelectorAll('body *'));
  });

  await addBtn.click();
  // Attend que le badge augmente
  await page.waitForFunction(
    ({ sel, before }) => {
      const el = document.querySelector(sel);
      return el && parseInt(el.textContent || '0', 10) > before;
    },
    { sel: '#k-modal-cart-badge', before: badgeBefore },
    { timeout: 6_000 }
  );
  // Attend la disparition réelle de la particule fly-to-cart (b-cart.js) —
  // un test/capture "état stable" pris avant cette disparition la verrait
  // encore visible au-dessus des actions.
  await page.waitForFunction(
    () => !document.querySelector('.k-fly-particle'),
    null,
    { timeout: 3_000 }
  );
}`;

const source = fs.readFileSync(target, 'utf8');
const occurrences = source.split(before).length - 1;
if (occurrences !== 1) {
  throw new Error(
    `[FAIL-CLOSED] bloc addToCartFromModal attendu exactement 1 fois, trouvé ${occurrences}. ` +
    'Aucun fichier modifié.'
  );
}

const next = source.replace(before, after);
fs.writeFileSync(target, next, 'utf8');
console.log('✓ Helper Playwright SKU-aware appliqué : public/boutique/tests/e2e/helpers/boutique.helpers.js');
console.log('  Supprimez tools/reconcile-playwright-modal-selection-once.js avant le commit final.');
