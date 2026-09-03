/**
 * @komerce-arch-lite
 * @role          checkout-desktop-style-loader
 * @domain        checkout
 * @layer         ui-runtime
 * @owner         public/boutique/js/b-checkout.js
 * @purpose       Charger le bundle desktop du checkout sans injecter de règles CSS depuis JavaScript.
 * @impact-areas  checkout, shared-cart, desktop-layout
 * @version       2026-09
 */
'use strict';

const STYLE_ID = 'k-checkout-desktop-v2-style';
const STYLE_HREF = '/boutique/css/dist/checkout-desktop-v2.css?v=1';

export function ensureCheckoutDesktopV2Stylesheet() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null;
  if (typeof window.matchMedia === 'function' && !window.matchMedia('(min-width: 900px)').matches) {
    return null;
  }

  const existing = document.getElementById(STYLE_ID);
  if (existing) return existing;

  const link = document.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  link.href = STYLE_HREF;
  link.media = '(min-width: 900px)';
  link.dataset.checkoutDesktopV2 = 'true';
  document.head.appendChild(link);
  return link;
}

// Le module est chargé avec le contrôleur shared-list au boot de la Boutique.
// Sur desktop, le CSS est donc prêt avant l'ouverture effective du checkout ;
// sur mobile aucun asset supplémentaire n'est chargé.
ensureCheckoutDesktopV2Stylesheet();
