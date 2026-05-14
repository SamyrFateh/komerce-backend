/**
 * @component Boutique / Polish Bootstrap
 * @owner b-boutique-wow-style.js
 *
 * Responsibility:
 * - Load temporary polish layers while they are being migrated/stabilized.
 * - Activate the existing hero proverb slot with a reload-rotated proverb.
 *
 * Must not:
 * - Mutate catalog/cart state.
 * - Patch b-pager.js behavior.
 * - Render product or category markup.
 * - Add supplier-specific styling.
 * - Use the hero bubble as cart avatar: the cart lady belongs to #k-cart-btn.
 *
 * See:
 * - docs/BOUTIQUE_COMPONENT_OWNERSHIP.md
 * - docs/BOUTIQUE_DESKTOP_REDESIGN_BRIEF.md
 * - docs/BOUTIQUE_CATEGORY_NAVIGATION_REDESIGN.md
 */

'use strict';

const WOW_STYLE_ID = 'k-boutique-wow-style';
const WOW_STYLE_HREF = '/boutique/css/boutique-wow.css?v=8';
const HERO_CART_PROXY_STYLE_ID = 'k-hero-cart-proxy-style';
const HERO_CART_PROXY_STYLE_HREF = '/boutique/css/hero-cart-proxy.css?v=5';
const DESKTOP_COMMERCE_STYLE_ID = 'k-desktop-commerce-skeleton-style';
const DESKTOP_COMMERCE_STYLE_HREF = '/boutique/css/desktop-commerce-skeleton.css?v=1';

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

function ensureStyle(id, href) {
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

function pickReloadProverb() {
  return KOMERCE_PROVERBS[Math.floor(Math.random() * KOMERCE_PROVERBS.length)];
}

function setupReloadProverb() {
  const node = document.getElementById('k-proverb-text');
  const catsShell = document.querySelector('.k-cats-shell');
  if (!node || !catsShell) return;

  if (!node.classList.contains('k-proverb-in-cats')) {
    node.classList.add('k-proverb-in-cats');
    catsShell.appendChild(node);
  }

  node.textContent = pickReloadProverb();
  node.setAttribute('aria-live', 'polite');
}

export function setupBoutiqueWowStyle() {
  if (typeof document === 'undefined') return;

  ensureStyle(WOW_STYLE_ID, WOW_STYLE_HREF);
  ensureStyle(HERO_CART_PROXY_STYLE_ID, HERO_CART_PROXY_STYLE_HREF);
  ensureStyle(DESKTOP_COMMERCE_STYLE_ID, DESKTOP_COMMERCE_STYLE_HREF);
  setupReloadProverb();
}
