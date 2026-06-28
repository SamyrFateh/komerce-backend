# KOMERCE — Architecture · Modal Produit Mobile

> Statut : document local historique.  
> Source canonique actuelle : `../../../docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md`.  
> Ownership global : `../../../docs/boutique/BOUTIQUE_COMPONENT_OWNERSHIP.md`.

Ce fichier ne doit plus servir de source de vérité pour modifier la modal mobile.

L'ancien gel v1.0 décrivait une modal mobile portée par un `modal.css` monolithique. Le code actuel est split en owners explicites `modal-*` et modules `b-modal-*`. En cas de divergence, les documents canoniques sous `docs/boutique/` gagnent.

## Owners actuels du parcours mobile

| Zone | Owner actuel |
|---|---|
| Orchestration modal | `public/boutique/js/b-modal-core.js` |
| Rendu produit mobile | `public/boutique/js/b-modal-product.js` |
| Images, carousel, fullscreen, bouton **Voir en grand** | `public/boutique/js/b-modal-image-ux.js` |
| Social proof conditionnel | `public/boutique/js/b-modal-social-proof.js` |
| Shell / topbar / scroll / actions | `public/boutique/css/modal-shell.css` |
| Media / carousel / bouton **Voir en grand** | `public/boutique/css/modal-media.css` |
| Détails produit / prix / actions | `public/boutique/css/modal-product.css` |

## Règle opérationnelle

Pour tout bug mobile modal, commencer par :

```bash
npm run gate:boutique-ownership
```

Puis lire :

```txt
docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md
docs/boutique/BOUTIQUE_COMPONENT_OWNERSHIP.md
features/catalog.feature.js
```

Ne pas corriger le bouton **Voir en grand** depuis `b-catalog.js`, `products.css`, `boutique-desktop.css` ou un ancien `modal.css`.
