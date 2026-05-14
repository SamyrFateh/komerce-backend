/**
 * @component Boutique / Wow Polish Style Loader
 * @owner b-boutique-wow-style.js
 *
 * Responsibility:
 * - Load the reversible wow-polish CSS layer.
 * - Keep the polish isolated from core pager, catalog and cart logic.
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
const WOW_STYLE_HREF = '/boutique/css/boutique-wow.css?v=3';

export function setupBoutiqueWowStyle() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(WOW_STYLE_ID)) return;

  const link = document.createElement('link');
  link.id = WOW_STYLE_ID;
  link.rel = 'stylesheet';
  link.href = WOW_STYLE_HREF;
  document.head.appendChild(link);
}
