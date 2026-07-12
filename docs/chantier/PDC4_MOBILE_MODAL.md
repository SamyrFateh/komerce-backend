# PDC-4 — Modal produit mobile enrichie

> Statut : chantier stacké au-dessus de PDC-3
> Owner : feature `modal-product`
> Doctrine : `docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md`

## Cible

Brancher la composition mobile sur :

```text
GET /api/products/:id/detail
        ↓
modal-selection-model.js
        ↓
b-modal-mobile-product.js
```

## Invariants

- vignettes couleur photo depuis `option_axes[].values[].thumbnail_url` ;
- disponibilité des tailles depuis `selection.option_states`, jamais `product_variants.stock` ;
- clic sur une option indisponible autorisé uniquement pour afficher la raison contextuelle produite par le reducer ;
- `selected_sku_id` obligatoire pour activer Ajouter/Acheter sur un produit en mode SKU ;
- galerie mobile reconstruite depuis `selected_media` ;
- le libellé éditorial média n'utilise `Mises en scène` que si le contrat porte réellement un média `SCENE` ;
- Standard / Express ne sont jamais codés comme liste frontend : la modal rend `delivery_options` ;
- `price_kmf = null` ou `eta_label = null` ne déclenche aucun fallback `Gratuit` / `3 à 5 semaines` ;
- desktop reste hors périmètre de PDC-4 ;
- le rendu legacy n'est pas requalifié comme SKU-ready.

## Hors périmètre

- refonte desktop ;
- suppression globale de `_renderVariants` ;
- extinction des produits `LEGACY_VARIANTS` ;
- création de SKU depuis la modal ;
- décision de rail ou pricing transport.
