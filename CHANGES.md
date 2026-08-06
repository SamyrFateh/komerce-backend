# Changements appliqués (session du 2026-08-06)

## Bug #1 — Historique absent sur une liste fermée (Suivi > Listes)
- `public/boutique/css/layout.css`
  - Exception `:not([data-mode="shared-list"])` ajoutée à la règle qui masque
    `.k-side-cart` sur l'onglet Suivi, pour ne pas masquer le side cart quand
    il affiche une liste en mode snapshot.

## Bug #4 — Liste perdue du checkout au moment du partage
- `public/boutique/js/b-share-cart.js`
  - Suppression du clic simulé sur `#k-cart-btn` dans
    `openSharedListInCanonicalCart()` : il déclenchait `openCart()` →
    `setCartSurface('personal')`, écrasant le contexte de liste qu'on venait
    d'activer.

## "Mes listes" retiré de Mon Komerce (doublon d'entrée point confirmé par Tony)
- `public/boutique/js/b-komerce.js` — section/bouton "🎁 Mes listes" retirés
  du shell de Mon Komerce.
- `public/boutique/js/b-nav.js` — bus `nav:goto-group` retiré (plus
  d'émetteur).
- `public/boutique/js/b-tracking.js` — commentaire mis à jour.
- `public/boutique/tests/unit/b-nav.test.js` — test obsolète retiré.
- Suivi reste l'unique entrée vers la bibliothèque de listes (le deep-link
  `?tab=group` legacy continue de fonctionner, inchangé).

## Tests / gates
- `npx jest` (boutique, suite complète) : 113 suites / 1727 tests — verts.
- `code-quality-gate.js --strict` : 0 violation.
- `feature-guard.js --strict` : 0 erreur, 0 avertissement.
- `css-guard.js` : 170 conflits = baseline (aucune régression).

## Toujours ouverts (non touchés, besoin de repro live)
- Bug #2 — bas du panier tronqué dans la modale produit. Piste : `.k-side-cart`
  a `overflow:hidden` (boutique-desktop.css) jamais réinitialisé par
  `.k-side-cart--in-modal` lors du reparentage dans `.k-modal-cart-slot`.
  Patch candidat non appliqué (risque site entier) :
  `.k-side-cart--in-modal { overflow: visible; }` — à valider en devtools
  avant application.
- Bug #3 — badge promo sur le texte (bloc "À associer avec"). DOM/CSS
  structurels corrects (badge bien imbriqué dans `.k-sug-card-img`,
  `position:relative` présent). Piste principale : images produits non
  chargées au moment de la capture (lazy-loading) — à confirmer après
  rafraîchissement complet.
