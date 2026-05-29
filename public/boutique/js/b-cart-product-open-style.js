/**
 * @module b-cart-product-open-style
 * @brief Charge les modules UX légers branchés au boot boutique.
 */

export function setupCartProductOpenStyle() {
  // NOTE 2026-05-19 : injection de cart-product-open.css retirée — fichier
  // orphelin (cf. docs/BOUTIQUE_ARCHITECTURE_LIVE.md), n'existe plus dans le
  // build. Provoquait "Refused to apply style ... MIME type 'text/html'" car
  // le serveur renvoyait l'index HTML en fallback SPA.

  // FIX BUG-H3 : shared-followup.css est déjà inclus dans components.css
  // (bundle dist). Le chargement dynamique était redondant et utilisait un
  // cache-buster ?v=1 incohérent avec le ?v=7 du bundle.

  // Compatibilité lien public court /g/:token → /event/w/:token.
  import('./b-friendly-group-redirect.js')
    .then(function(mod) {
      if (mod && typeof mod.setupFriendlyGroupRedirect === 'function') {
        mod.setupFriendlyGroupRedirect();
      }
    })
    .catch(function(err) {
      console.warn('[friendly-group-link] chargement impossible', err);
    });

  // NOTE: b-cart-groups-tab.js retiré — setupCartGroupsTab() est vide (legacy désactivé).
  // Le flux Groupe officiel vit dans b-group-view.js + group/group-api.js.

  // Desktop : la petite dame doit toujours ouvrir un vrai panier,
  // même dans Favoris/Suivi où le side-cart peut être invisible.
  import('./b-desktop-global-cart-access.js')
    .then(function(mod) {
      if (mod && typeof mod.setupDesktopGlobalCartAccess === 'function') {
        mod.setupDesktopGlobalCartAccess();
      }
    })
    .catch(function(err) {
      console.warn('[desktop-cart-access] chargement impossible', err);
    });
}
