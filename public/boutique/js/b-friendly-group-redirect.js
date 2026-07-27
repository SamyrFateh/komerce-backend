/**
 * @komerce-arch-lite
 * @role          boutique-b-friendly-group-redirect
 * @domain        shared-cart
 * @layer         ui-component
 * @owner         public/boutique/js/b-group-view.js
 * @purpose       supports public/boutique/js/b-group-view.js
 * @impact-areas  boutique
 * @version       2026-06
 */
'use strict';

/**
 * @module b-friendly-group-redirect
 * @brief Compatibilité lien public court /g/:token.
 *
 * Tant que server.js ne sert pas directement /g/:token vers la page événement,
 * le fallback SPA renvoie la boutique. Ce module redirige alors immédiatement
 * vers la page publique collective existante /event/w/:token.
 */

export function setupFriendlyGroupRedirect() {
  const match = window.location.pathname.match(/^\/g\/([A-Za-z0-9_-]+)$/);
  if (!match) return;

  const token = match[1];
  if (!token || token.length > 120) {
    window.location.replace('/boutique/');
    return;
  }

  window.location.replace('/event/w/' + encodeURIComponent(token));
}
