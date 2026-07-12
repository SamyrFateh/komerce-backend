# PDC-5 — Modal produit desktop sur sélection SKU partagée

> Statut : chantier stacké au-dessus de PDC-4
> Owner : feature `modal-product`
> Doctrine : `docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md`

## Cible

Le desktop ne possède plus une seconde intelligence produit.

```text
GET /api/products/:id/detail
        ↓
b-modal-product-detail-bootstrap.js
        ↓
modal-selection-model.js
        ↓
state.modalSelection
        ↓
b-modal-desktop-product.js
        ↓
galerie gauche + Buy Box droite
```

Mobile et desktop partagent :

```text
Product Detail Contract
selected_options
selected_sku_id
selected_media
option_states
selection_message
```

Ils ne partagent pas leur composition visuelle.

## Responsabilités PDC-5

### `b-modal-product-detail-bootstrap.js`

- un fetch Product Detail par ouverture produit ;
- une création de sélection ;
- ignore les réponses obsolètes ;
- choisit le renderer selon le viewport ;
- garde transitoirement la modal contre un repaint legacy jusqu'à PDC-6.

### `b-modal-desktop-product.js`

- identité et référence ;
- prix du SKU sélectionné ou prix produit du contrat ;
- ancien prix uniquement si `old_price_kmf` existe ;
- axes et options depuis le contrat ;
- disponibilité depuis `state.modalSelection` ;
- raison d'indisponibilité ;
- livraison depuis `delivery_options` ;
- sous-total `prix courant × modalQty` ;
- galerie depuis `selected_media`.

### `b-modal-desktop-enhancers.js`

Composition éditoriale uniquement :

- breadcrumb ;
- partage ;
- trust générique ;
- récemment vus.

Il ne calcule plus :

- prix ;
- ancien prix ;
- économie EUR ;
- stock ;
- rareté ;
- livraison ;
- sous-total.

### `b-modal-approche-c-hybrid.js`

Conserve :

- placement actions ;
- garde minimale de quantité ;
- UI paiement ;
- entrée partage.

Il ne rend plus la livraison produit ni le sous-total produit.

## Invariants

- une unité vendable = un SKU ;
- le desktop lit le même `state.modalSelection` que le mobile ;
- aucune disponibilité n'est reconstruite depuis `product_variants.stock` ;
- une option indisponible reste explicable par le reducer ;
- Ajouter/Acheter restent désactivés sans `selected_sku_id` pour un produit SKU ;
- une livraison absente du contrat n'est pas inventée ;
- `old_price_kmf = null` n'autorise aucun ancien prix dérivé de `promo_pct` ;
- le sous-total utilise le prix courant de l'unité sélectionnée ;
- les enhancers desktop ne sont plus un second moteur produit ;
- aucun CSS parallèle n'est créé dans PDC-5.

## Dette volontaire jusqu'à PDC-6

Le fetch legacy de `b-modal-core.js` peut encore repeindre les variantes après le Product Detail Contract.

Un guard transitoire vérifie :

```text
mobile  → [data-pdc4-root]
desktop → [data-pdc5-root]
```

et rerend depuis l'état partagé si nécessaire.

PDC-6 doit supprimer ensemble :

- le fetch variantes legacy de la modal ;
- le guard de repaint ;
- l'alias `b-modal-mobile-product-bootstrap.js` ;
- les derniers owners structurels legacy devenus inutiles après confrontation runtime.

## Tests obligatoires

1. même SKU résolu mobile et desktop ;
2. Marron rend L en rupture depuis les SKU réels ;
3. clic L explique la rupture ;
4. Marron + M résout le SKU exact et ses médias ;
5. Beige + L peut porter un prix SKU différent ;
6. quantité modifiée → sous-total mis à jour ;
7. Express n'apparaît que si `delivery_options` le fournit ;
8. aucun fallback `Gratuit` / `3 à 5 semaines` ;
9. aucun ancien prix reconstruit depuis `promo_pct` ;
10. enhancers desktop : aucun write prix/stock/livraison/sous-total ;
11. bootstrap : un fetch et une sélection pour les deux viewports ;
12. repaint legacy tardif : PDC-5 restauré depuis l'état partagé.
