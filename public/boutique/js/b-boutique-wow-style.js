/**
 * @component Boutique / Wow Polish Style Loader
 * @owner b-boutique-wow-style.js
 *
 * Responsibility:
 * - Load the reversible wow-polish CSS layer.
 * - Keep the polish isolated from core pager, catalog and cart logic.
 * - Activate the existing hidden hero proverb slot with a reload-rotated proverb.
 *
 * Must not:
 * - Mutate catalog/cart state.
 * - Patch b-pager.js behavior.
 * - Render product or category markup.
 *
 * See:
 * - docs/BOUTIQUE_COMPONENT_OWNERSHIP.md
 */

'use strict';

const WOW_STYLE_ID = 'k-boutique-wow-style';
const WOW_STYLE_HREF = '/boutique/css/boutique-wow.css?v=5';

const KOMERCE_PROVERBS = [
  'Celui qui cherche trouve son trésor.',
  'Petit à petit, le panier se remplit.',
  'Chaque colis a son chemin.',
  'Qui choisit bien reçoit mieux.',
  'Un bon achat voyage loin.',
  'Le marché sourit aux patients.',
  'Le bon choix traverse la mer.',
  'Quand le cœur choisit, le panier suit.'
];

function pickReloadProverb() {
  return KOMERCE_PROVERBS[Math.floor(Math.random() * KOMERCE_PROVERBS.length)];
}

function setupReloadProverb() {
  const node = document.getElementById('k-proverb-text');
  if (!node) return;
  node.textContent = pickReloadProverb();
  node.setAttribute('aria-live', 'polite');
}

export function setupBoutiqueWowStyle() {
  if (typeof document === 'undefined') return;

  if (!document.getElementById(WOW_STYLE_ID)) {
    const link = document.createElement('link');
    link.id = WOW_STYLE_ID;
    link.rel = 'stylesheet';
    link.href = WOW_STYLE_HREF;
    document.head.appendChild(link);
  }

  setupReloadProverb();
}
