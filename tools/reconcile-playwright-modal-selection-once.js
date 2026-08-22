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
 * [data-option-value][data-option-state]. Les renderers desktop et mobile
 * recalculent option_states après chaque clic ; on re-query donc le DOM à
 * chaque axe au lieu de conserver des locators devenus obsolètes après rerender.
 *
 * Aucun choix n'est inventé : on ne clique que des options explicitement
 * marquées AVAILABLE par le contrat produit. Si aucune combinaison achetable
 * n'existe, le helper échoue et laisse le produit/test rouge.
 */
async function ensureModalPurchaseReady(page) {
  const addBtn = page.locator('#k-add-cart-btn');
  if (await addBtn.isEnabled().catch(() => false)) return;

  const axisCount = await page.locator('[data-axis-key]').count();
  if (axisCount === 0) return;

  // Une sélection d'axe rerend la composition. Plusieurs passes permettent
  // aux option_states recalculés de converger sans jamais choisir OUT_OF_STOCK
  // ou INCOMPATIBLE.
  const maxPasses = Math.max(2, axisCount + 1);
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const axisKeys = await page.locator('[data-axis-key]').evaluateAll((axes) =>
      axes.map((axis) => axis.getAttribute('data-axis-key')).filter(Boolean)
    );

    for (const axisKey of axisKeys) {
      if (await addBtn.isEnabled().catch(() => false)) return;

      // Re-query après chaque rerender. CSS.escape n'est pas nécessaire ici :
      // on filtre l'attribut par evaluateAll, donc aucune interpolation CSS de
      // la clé issue du backend.
      const axis = page.locator('[data-axis-key]').filter({
        has: page.locator('button[data-option-value]'),
      }).filter({
        has: page.locator(`button[data-option-value]`),
      });

      const current = page.locator('[data-axis-key]').filter({
        has: page.locator('button[data-option-value]'),
      });
      const count = await current.count();
      let axisLocator = null;
      for (let i = 0; i < count; i += 1) {
        const candidate = current.nth(i);
        if ((await candidate.getAttribute('data-axis-key')) === axisKey) {
          axisLocator = candidate;
          break;
        }
      }
      if (!axisLocator) continue;

      const activeAvailable = axisLocator.locator(
        'button[data-option-state="AVAILABLE"][aria-pressed="true"]'
      );
      if ((await activeAvailable.count()) > 0) continue;

      const available = axisLocator.locator('button[data-option-state="AVAILABLE"]');
      const availableCount = await available.count();
      if (availableCount === 0) continue;

      await available.first().click();
      // L'event click déclenche un rerender synchrone puis la réconciliation
      // panier en microtask. Attendre explicitement que l'axe ait une valeur
      // active ou que le CTA devienne achetable évite toute temporisation fixe.
      await expect
        .poll(async () => {
          if (await addBtn.isEnabled().catch(() => false)) return true;
          return (await page.locator(
            '[data-axis-key] button[data-option-state="AVAILABLE"][aria-pressed="true"]'
          ).count()) > 0;
        }, { timeout: 2_000 })
        .toBe(true);
    }

    if (await addBtn.isEnabled().catch(() => false)) return;
  }
}

/** Ajoute le produit actuellement ouvert dans la modale au panier. */
async function addToCartFromModal(page) {
  const addBtn = page.locator('#k-add-cart-btn');

  // Produit SIMPLE : le bouton est déjà actif. Produit SKU : le contrat exige
  // une combinaison résolue avant l'achat. Le helper suit exactement cette
  // règle au lieu de dépendre du hasard de la première carte du catalogue.
  await ensureModalPurchaseReady(page);
  await expect(addBtn).toBeEnabled({ timeout: 5_000 });

  const badgeBefore = parseInt(
    (await page.locator('#k-modal-cart-badge').textContent().catch(() => '0')) || '0',
    10
  );

  // Snapshot de l'état STABILISÉ (après sélection éventuelle des variantes) :
  // assertNoOverlayOnActions n'inspecte ainsi que ce qui apparaît réellement
  // à cause de l'ajout au panier, jamais les éléments créés par un rerender SKU.
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
