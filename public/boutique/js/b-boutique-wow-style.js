/**
 * @component Boutique / Wow Polish Style Loader
 * @owner b-boutique-wow-style.js
 *
 * Responsibility:
 * - Load the reversible wow-polish CSS layer.
 * - Keep the polish isolated from core pager, catalog and cart logic.
 * - Activate the existing hidden hero proverb slot with a reload-rotated proverb.
 * - Turn the existing hero bubble into a cart proxy on mobile.
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
const WOW_STYLE_HREF = '/boutique/css/boutique-wow.css?v=8';
const HERO_CART_PROXY_STYLE_ID = 'k-hero-cart-proxy-style';
const HERO_CART_PROXY_STYLE_HREF = '/boutique/css/hero-cart-proxy.css?v=2';

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

  // Le slot existe dans .k-hero-overlay, mais cet overlay doit rester masqué en mobile
  // pour éviter de faire réapparaître les anciens titres/pills du hero.
  // On déplace donc le vrai node prévu dans le bloc catégories, sans créer de faux contenu CSS.
  if (!node.classList.contains('k-proverb-in-cats')) {
    node.classList.add('k-proverb-in-cats');
    catsShell.appendChild(node);
  }

  node.textContent = pickReloadProverb();
  node.setAttribute('aria-live', 'polite');
}

function forceHeroCartProxyVisible(proxy) {
  if (!proxy || window.innerWidth >= 900) return;

  Object.assign(proxy.style, {
    display: 'flex',
    position: 'absolute',
    right: '14px',
    top: '12px',
    zIndex: '12',
    width: '34px',
    height: '34px',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '999px',
    background: "rgba(255, 252, 244, .90) url('/images/avatar_seule.png') center / cover no-repeat",
    border: '1px solid rgba(198, 168, 93, .24)',
    boxShadow: '0 4px 12px rgba(31, 48, 36, .10)',
    overflow: 'hidden',
    cursor: 'pointer',
    fontSize: '0',
    WebkitTapHighlightColor: 'transparent'
  });
}

function setupHeroCartProxy() {
  const proxy = document.querySelector('.k-hero-bubble');
  if (!proxy) return;

  proxy.classList.add('k-hero-cart-proxy');
  proxy.removeAttribute('aria-hidden');
  proxy.setAttribute('role', 'button');
  proxy.setAttribute('tabindex', '0');
  proxy.setAttribute('aria-label', 'Ouvrir le panier');
  proxy.textContent = '';

  forceHeroCartProxyVisible(proxy);
  requestAnimationFrame(function() { forceHeroCartProxyVisible(proxy); });
  setTimeout(function() { forceHeroCartProxyVisible(proxy); }, 250);

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

  setupReloadProverb();
  setupHeroCartProxy();
}
