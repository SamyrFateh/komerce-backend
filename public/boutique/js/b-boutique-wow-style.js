/**
 * @component Boutique / Polish Bootstrap
 * @owner b-boutique-wow-style.js
 *
 * Responsibility:
 * - Load temporary polish layers while they are being migrated/stabilized.
 * - Activate the existing hero proverb slot with a reload-rotated proverb.
 * - Turn the existing hero bubble into a cart proxy on mobile.
 *
 * Must not:
 * - Mutate catalog/cart state.
 * - Patch b-pager.js behavior.
 * - Render product or category markup.
 * - Add supplier-specific styling.
 * - Force visual styles inline: avatar visuals belong to hero-cart-proxy.css.
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
const HERO_CART_PROXY_STYLE_HREF = '/boutique/css/hero-cart-proxy.css?v=4';
const DESKTOP_COMMERCE_STYLE_ID = 'k-desktop-commerce-skeleton-style';
const DESKTOP_COMMERCE_STYLE_HREF = '/boutique/css/desktop-commerce-skeleton.css?v=1';
const DESKTOP_HORIZONTAL_NAV_STYLE_ID = 'k-desktop-horizontal-nav-style';
const DESKTOP_HORIZONTAL_NAV_STYLE_HREF = '/boutique/css/desktop-horizontal-nav.css?v=1';

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

function detachCartProxyFromHeroImage(proxy) {
  const heroWrap = document.getElementById('k-hero-fixed-wrap');
  if (!heroWrap || !proxy) return;
  if (proxy.parentElement === heroWrap) return;
  heroWrap.appendChild(proxy);
}

function setupHeroCartProxy() {
  const proxy = document.querySelector('.k-hero-bubble');
  if (!proxy) return;

  detachCartProxyFromHeroImage(proxy);

  proxy.classList.add('k-hero-cart-proxy');
  proxy.removeAttribute('aria-hidden');
  proxy.setAttribute('role', 'button');
  proxy.setAttribute('tabindex', '0');
  proxy.setAttribute('aria-label', 'Ouvrir le panier');
  proxy.textContent = '';

  if (proxy.dataset.boundCartProxy === '1') return;
  proxy.dataset.boundCartProxy = '1';

  const openCart = function() {
    const cartButton = document.getElementById('k-cart-btn');
    if (cartButton) cartButton.click();
  };

  proxy.addEventListener('click', openCart);
  proxy.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    openCart();
  });
}

export function setupBoutiqueWowStyle() {
  if (typeof document === 'undefined') return;

  ensureStyle(WOW_STYLE_ID, WOW_STYLE_HREF);
  ensureStyle(HERO_CART_PROXY_STYLE_ID, HERO_CART_PROXY_STYLE_HREF);
  ensureStyle(DESKTOP_COMMERCE_STYLE_ID, DESKTOP_COMMERCE_STYLE_HREF);
  ensureStyle(DESKTOP_HORIZONTAL_NAV_STYLE_ID, DESKTOP_HORIZONTAL_NAV_STYLE_HREF);

  setupReloadProverb();
  setupHeroCartProxy();
}
