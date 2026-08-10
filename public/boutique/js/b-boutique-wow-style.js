/**
 * @komerce-arch-lite
 * @role          boutique-product-image-fallback-polish
 * @domain        catalog
 * @layer         ui-component
 * @owner         public/boutique/js/boutique.js
 * @purpose       Preserve a showcase-quality product surface when a media asset fails.
 * @impact-areas  boutique, catalog, product-media
 * @version       2026-08
 */
'use strict';

/**
 * @component Boutique / Product image fallback polish
 * @owner b-boutique-wow-style.js
 *
 * La couche "wow" historique reste supprimée. Ce module conserve uniquement
 * un rôle de bootstrap de polish transversal déjà appelé par boutique.js :
 * remplacer le fallback technique 📦 de b-utils par un fallback vitrine
 * Komerce, sans réintroduire de CSS legacy ni de dépendance réseau.
 *
 * IMPORTANT : le fallback reste un filet de sécurité UX. Le catalogue staging
 * de référence doit être audité séparément et ne doit pas tolérer des médias
 * manquants.
 */

'use strict';

const FALLBACK_MARKER = 'kFallbackPolished';
const INSTALL_MARKER = '__kProductFallbackPolishInstalled';

const FALLBACK_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320">',
  '<defs>',
  '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">',
  '<stop offset="0" stop-color="#ffffff"/>',
  '<stop offset="1" stop-color="#fff8cf"/>',
  '</linearGradient>',
  '<radialGradient id="sun" cx="82%" cy="15%" r="55%">',
  '<stop offset="0" stop-color="#ffe11a" stop-opacity=".72"/>',
  '<stop offset="1" stop-color="#ffe11a" stop-opacity="0"/>',
  '</radialGradient>',
  '</defs>',
  '<rect width="320" height="320" rx="30" fill="url(#bg)"/>',
  '<rect width="320" height="320" rx="30" fill="url(#sun)"/>',
  '<rect x="101" y="78" width="118" height="132" rx="30" fill="#fff" stroke="#eadf9d" stroke-width="2"/>',
  '<path d="M132 118c0-20 12-34 28-34s28 14 28 34" fill="none" stroke="#1f3024" stroke-width="8" stroke-linecap="round"/>',
  '<text x="160" y="177" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="58" font-weight="800" fill="#1f3024">K</text>',
  '<text x="160" y="250" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="13" font-weight="700" letter-spacing="3" fill="#667269">KOMERCE</text>',
  '<text x="160" y="273" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="11" fill="#8b938d">IMAGE BIENTÔT DISPONIBLE</text>',
  '</svg>',
].join('');

export const SHOWCASE_PRODUCT_FALLBACK_URL =
  'data:image/svg+xml,' + encodeURIComponent(FALLBACK_SVG);

/**
 * Remplace visuellement une image déjà passée en fallback technique.
 * Le marqueur kFallbackApplied appartient à b-utils et évite que son handler
 * inline reprenne la main lorsque notre data URI se charge.
 */
export function polishFallbackImage(image) {
  if (!image || image.dataset?.[FALLBACK_MARKER] === '1') return false;
  image.dataset.kFallbackApplied = '1';
  image.dataset[FALLBACK_MARKER] = '1';
  image.removeAttribute('srcset');
  image.alt = '';
  image.classList.add('is-image-fallback');
  image.src = SHOWCASE_PRODUCT_FALLBACK_URL;
  return true;
}

function upgradeFallbacksIn(node) {
  if (!node) return;
  if (node.matches?.('img.is-image-fallback')) polishFallbackImage(node);
  node.querySelectorAll?.('img.is-image-fallback').forEach(polishFallbackImage);
}

/**
 * Installe un filet global, idempotent :
 * - capture les erreurs IMG avant les handlers inline legacy ;
 * - upgrade les fallbacks techniques appliqués lors d'un onload "tiny image" ;
 * - couvre aussi les images injectées après le boot (pagination, modal, cart).
 */
export function setupBoutiqueWowStyle() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (window[INSTALL_MARKER]) return;
  window[INSTALL_MARKER] = true;

  document.addEventListener('error', (event) => {
    const target = event.target;
    if (target?.tagName === 'IMG') polishFallbackImage(target);
  }, true);

  upgradeFallbacksIn(document);

  if (typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes') {
          upgradeFallbacksIn(record.target);
          continue;
        }
        record.addedNodes.forEach(upgradeFallbacksIn);
      }
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    window.__kProductFallbackPolishObserver = observer;
  }
}
