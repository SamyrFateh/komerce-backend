# Boutique — Architecture modal produit

> Mis à jour : **2026-07-12**  
> Statut : document actif pour modifier la modal produit Boutique.  
> Doctrine amont obligatoire : `../doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md`.

---

## 1. Rôle

La modal produit est la **fiche produit transactionnelle de Komerce** pour le catalogue vivant.

Elle permet de comprendre le produit, voir son identité et son prix, sélectionner une unité réellement vendable, comprendre une indisponibilité, voir les options de livraison commercialement exposées, choisir une quantité et déclencher Ajouter / Acheter.

Elle reste distincte de la fiche article lecture seule du panier partagé, construite depuis le snapshot dans `b-group-view.js`.

```txt
Catalogue vivant → modal produit globale enrichie.
Panier partagé participant → fiche snapshot lecture seule.
```

Règle responsive :

> **Une intelligence produit. Deux compositions responsive.**

Mobile et desktop consomment le même contrat détail et le même état de sélection. Ils peuvent organiser l'écran différemment ; ils ne possèdent jamais deux logiques de stock, prix, médias ou livraison.

---

## 2. Chaîne active

Le Product Detail Contract v1 est servi par :

```txt
GET /api/products/:id/detail
```

Le chemin cible est :

```txt
GET /api/products/:id/detail
      ↓
product_detail_v1
      ↓
modal-selection-model.js
      ↓
selected_options
selected_sku_id
selected_media
option_states
selection_message
      ↓
renderers mobile / desktop
```

### État au PDC-4

Le **mobile SKU consomme réellement cette chaîne** via :

```txt
b-modal.js
  ↓ side-effect import
b-modal-product-detail-mobile.js
  ↓ modal:opened
GET /api/products/:id/detail
  ↓
modal-selection-model.js
  ↓
rendu mobile SKU
```

Le desktop reste sur la composition historique jusqu'à PDC-5.

`LEGACY_VARIANTS` reste explicitement sur le renderer historique jusqu'à PDC-6/PDC-7. Le mobile PDC ne tente pas de fabriquer des `sellable_units` depuis les stocks d'axes legacy.

---

## 3. Owners actifs

### JS

| Zone | Owner |
|---|---|
| Façade publique / activation adaptateur mobile | `public/boutique/js/b-modal.js` |
| Cycle ouverture/fermeture, body lock, historique | `public/boutique/js/b-modal-core.js` |
| **Adaptateur Product Detail mobile SKU** | `public/boutique/js/b-modal-product-detail-mobile.js` |
| **État dérivé de sélection SKU unique** | `public/boutique/js/view-models/modal-selection-model.js` |
| Contrat d'affichage legacy / classes historiques | `public/boutique/js/view-models/modal-view-model.js` |
| Renderer variantes / livraison legacy | `public/boutique/js/b-modal-product.js` — fallback legacy uniquement à terme |
| Contrôles quantité / Ajouter modal | `public/boutique/js/b-modal-cart.js` |
| Identité exacte ligne panier `product + combo` | `public/boutique/js/b-cart-selection.js` |
| Images, carousel, lightbox fullscreen | `public/boutique/js/b-modal-image-ux.js` |
| Social proof | `public/boutique/js/b-modal-social-proof.js` |
| Navigation précédent/suivant | `public/boutique/js/b-modal-nav.js` |
| Suggestions | `public/boutique/js/b-modal-suggestions.js` |
| Composition et enrichissements desktop | `public/boutique/js/b-modal-desktop-enhancers.js` |

### Frontière d'ownership PDC-4

`b-modal-core.js` reste l'owner du lifecycle. PDC-4 ne crée pas un second `openModal()`.

`b-modal-product-detail-mobile.js` écoute :

```txt
modal:opened
modal:closed
```

et adapte uniquement les vérités produit du chemin mobile SKU.

`modal-selection-model.js` reste l'unique owner de la sélection. L'adaptateur mobile **consomme** le reducer ; il ne recalcule aucune disponibilité.

`modal-view-model.js` garde temporairement ses responsabilités historiques d'affichage. Il ne reçoit pas une seconde logique SKU.

---

## 4. Contrat détail consommé

Le mobile SKU consomme :

```txt
product
pricing
media
option_axes
sellable_units
delivery_options
inventory_model
```

Il ne lit directement ni `product_skus`, ni `product_variants`, ni `normalized_source_contract`.

### Interdit

- `product.stock` comme vérité du chemin mobile SKU ;
- `opt.stock` pour décider de la disponibilité d'une taille/couleur SKU ;
- reconstruction d'un ancien prix depuis `promo_pct` ;
- `product.delivery_delay || '3 à 5 semaines'` ;
- liste frontend fixe Standard / Express ;
- `Gratuit` inventé quand `price_kmf` est `null`.

---

## 5. Sélection SKU

> **Une unité vendable = un SKU.**

Exemple :

```txt
Marron + S → SKU A → AVAILABLE
Marron + M → SKU B → AVAILABLE
Marron + L → SKU C → OUT_OF_STOCK
Beige  + L → SKU D → AVAILABLE
```

Au départ, `L` peut être globalement `AVAILABLE` grâce à `Beige + L`.

Après :

```txt
Couleur = Marron
```

le reducer produit :

```txt
S → AVAILABLE
M → AVAILABLE
L → OUT_OF_STOCK
```

Un clic sur `L` garde la sélection actuelle et produit :

```txt
L indisponible pour Marron — rupture de stock
```

Une combinaison absente produit :

```txt
S indisponible pour Beige — combinaison non proposée
```

### État du reducer

```txt
inventory_model
selection_supported
selected_options
selected_sku_id
selected_media
option_states
selection_message
```

États autorisés :

```txt
AVAILABLE
OUT_OF_STOCK
INCOMPATIBLE
```

### Ordre des axes

L'ordre de `option_axes` est l'ordre de dépendance d'interaction.

```txt
Couleur
  ↓
Taille
```

Changer un axe amont efface les choix aval :

```txt
Marron + M
   ↓ Couleur = Beige
Beige
```

La taille n'est jamais conservée silencieusement.

### Sélection transactionnelle

`selected_sku_id` n'est posé que si :

1. tous les axes sont sélectionnés ;
2. une `sellable_unit` correspond exactement ;
3. son `stock_status` vaut `AVAILABLE`.

Aucune première option disponible n'est choisie silencieusement.

Un SKU par défaut sans axes peut être résolu immédiatement si son unité est disponible.

Pour `LEGACY_VARIANTS` :

```txt
selection_supported = false
selected_sku_id = null
option_states = {}
```

---

## 6. Rendu mobile SKU actif

Owner : `b-modal-product-detail-mobile.js`.

Ordre fonctionnel :

```txt
TOPBAR
MEDIA / GALERIE
IDENTITÉ + PRIX
OPTIONS VISUELLES
OPTIONS TEXTE / TAILLE
MESSAGE CONTEXTUEL
DELIVERY_OPTIONS
QUANTITÉ
AJOUTER / ACHETER
SUGGESTIONS
```

### Ouverture

`modal:opened` déclenche le fetch `/detail` sur viewport mobile.

Pendant le fetch :

```txt
Ajouter = disabled
Acheter = disabled
qty− = disabled
qty+ = disabled
```

Le libellé devient :

```txt
Chargement du produit…
```

Cette fenêtre ferme la course entre le rendu legacy synchrone et le contrat détail asynchrone.

### Décision après fetch

```txt
inventory_model = SKU
→ activer Product Detail + reducer

inventory_model = LEGACY_VARIANTS
→ déverrouiller + garder renderer legacy

HTTP non OK / réseau indisponible
→ déverrouiller + garder renderer legacy
```

Une réponse tardive d'un ancien produit ne peut pas remplacer le produit courant : `_requestVersion` + vérification `modalProduct.id` protègent la course.

### Axes et options

Les boutons portent l'état reçu du reducer :

```txt
data-option-state="AVAILABLE|OUT_OF_STOCK|INCOMPATIBLE"
```

Les options indisponibles restent cliquables avec `aria-disabled="true"` mais sans `disabled` HTML. Le clic doit atteindre le reducer pour afficher la raison contextuelle.

Le renderer ne filtre jamais les `sellable_units` lui-même.

### Prix

Ordre :

```txt
prix SKU sélectionné explicite
  ↓ fallback
pricing.price_kmf
```

`old_price_kmf` est affiché uniquement s'il existe dans le contrat.

`promo_pct` peut alimenter le badge promotion. Il ne sert jamais à recalculer un ancien prix.

### Stock affiché

Ordre :

```txt
selection_message
  ↓
selected SKU available_quantity
  ↓
axes restant à sélectionner
  ↓
rupture SKU par défaut
```

Le chemin SKU mobile ne lit pas `product.stock`.

---

## 7. Média

Le reducer dérive `selected_media` :

```txt
1. media_ids du SKU sélectionné
2. médias dont option_values correspondent à la sélection
3. médias globaux
4. galerie complète
```

Le mobile reconstruit le carousel depuis `selected_media` et rappelle `setupImageUX()` afin que compteur et fullscreen reflètent la galerie courante.

Aucune association n'est déduite depuis le filename, l'ordre d'une image ou une couleur dominante.

### Couture legacy temporaire

Le core lance encore un fetch historique `/api/products/:id` pour les variantes. Il peut terminer après `/detail` et écraser le conteneur.

PDC-4 installe temporairement un `MutationObserver` sur le conteneur variantes. Si le marker :

```txt
data-pdc-sku-selection="1"
```

disparaît alors que le contrat SKU courant reste actif, les axes PDC sont restaurés.

Ce guard est **une couture de convergence**, pas une architecture finale. PDC-6 supprime le fetch/rendu variante legacy du chemin SKU et doit retirer cet observer.

---

## 8. Livraison

La modal rend exactement :

```txt
delivery_options[]
```

Champs :

```txt
code
label
available
price_kmf
eta_label
unavailable_reason
```

Le panneau mobile supprime les blocs legacy `data-mobile-delivery`, `data-mobile-reassurance` et `data-mobile-trust` avant de rendre le contrat.

Il affiche :

- `label` toujours ;
- `price_kmf` uniquement s'il n'est pas `null` ;
- `eta_label` uniquement s'il existe ;
- `unavailable_reason` uniquement pour une option indisponible.

Donc :

```txt
price_kmf = null
≠ Gratuit

eta_label = null
≠ 3 à 5 semaines
```

`AIR_EXPRESS` absent du contrat reste absent de l'UI.

---

## 9. Panier et identité de sélection

Le backend commande reste autoritaire : le frontend transmet le snapshot `selected_options` comme `variant_combo`, puis `routes/orders/create.js` résout et revalide le SKU actif réel.

Le mobile synchronise :

```txt
state.modalVariantCombo = modalSelection.selected_options
```

`addToCart()` conserve donc son snapshot de sélection existant.

### Problème corrigé PDC-4

Les helpers historiques `quickAdd` / `quickRemove` ciblent d'abord un produit par `product_id`. Deux SKU du même produit peuvent donc avoir deux lignes différentes.

Le stepper SKU modal utilise désormais :

```txt
product_id + variant_combo canonique
```

Owner : `b-cart-selection.js`.

```txt
findCartItemForSelection(productId, combo)
setCartSelectionQty(productId, combo, quantity)
```

`b-cart-selection.js` ne crée pas de ligne et n'est pas un second moteur panier. La création reste à `addToCart()` ; la persistance/badges restent à `saveCart()`.

Le chemin legacy garde les helpers historiques jusqu'à extinction.

### CTA SKU

Sélection incomplète :

```txt
selected_sku_id = null
→ Ajouter disabled
→ Acheter disabled
→ stepper disabled
→ « Choisissez vos options »
```

Sélection complète :

```txt
selected_sku_id != null
→ quantité de la ligne product+combo exacte
→ Ajouter / Acheter actifs
```

---

## 10. Desktop — PDC-5

Cible :

```txt
┌─────────────────────────┬──────────────────────────┐
│     GALERIE / MÉDIAS    │  Nom / Référence         │
│                         │  Prix / Promotion         │
│   miniatures / scène    │  Options                  │
│   image dominante       │  disponibilité expliquée │
│                         │  delivery_options         │
│                         │  Quantité                 │
│                         │  AJOUTER / ACHETER        │
└─────────────────────────┴──────────────────────────┘
```

PDC-5 doit consommer **le même `state.modalSelection`**.

`b-modal-desktop-enhancers.js` ne doit plus reconstruire prix, stock, variantes, rails ou délais.

---

## 11. Extinction legacy — PDC-6

PDC-6 doit :

1. arrêter le fetch `/api/products/:id` de variantes pour le chemin SKU ;
2. retirer `_renderVariants` du chemin SKU ;
3. retirer `_injectMobileDelivery` / `_injectMobileTrust` du chemin SKU ;
4. supprimer le `MutationObserver` de convergence PDC-4 ;
5. empêcher `b-modal-core.js` de rendre les vérités transactionnelles depuis le produit liste brut sur le chemin SKU ;
6. réévaluer puis réduire `modal-view-model.js` legacy ;
7. vérifier qu'un seul owner subsiste par vérité.

Le fallback `LEGACY_VARIANTS` reste tant que PDC-7 n'autorise pas son extinction.

---

## 12. CSS

| Zone | Owner |
|---|---|
| Overlay / topbar / actions | `modal-shell.css` |
| Image / carousel / fullscreen | `modal-media.css` |
| Infos produit / options / actions | `modal-product.css` |
| Enrichissement desktop | `modal-product-lot4-hybrid.css` |

Le chemin PDC-4 réutilise volontairement les classes stables de la modal actuelle. Il n'injecte aucune règle CSS par JS.

Une disponibilité ou une livraison ne doit jamais être corrigée par CSS.

---

## 13. Tests obligatoires

PDC-4 couvre :

1. desktop → aucun fetch détail mobile ;
2. mobile SKU → `/api/products/:id/detail` ;
3. fetch en cours → CTA/stepper verrouillés ;
4. legacy / HTTP KO / réseau → fallback déverrouillé ;
5. réponse produit A tardive → ignorée si B est courant ;
6. Marron + L → `OUT_OF_STOCK` + message exact ;
7. Marron + M → SKU précis, prix SKU et médias associés ;
8. livraison exacte sans `Gratuit` / `3 à 5 semaines` inventés ;
9. ancien prix absent → aucune reconstruction ;
10. overwrite variantes legacy tardif → marker PDC restauré ;
11. quantité panier → ligne product+combo exacte ;
12. sélection SKU incomplète → aucun fallback `quickAdd` legacy ;
13. fermeture modal → détail et sélection purgés.

Commandes :

```bash
cd public/boutique
npm run check:fast
npm run test:coverage

cd ../..
npm run gate:boutique-ownership
npm run map:check
```

---

## 14. Invariants

- La modal catalogue affiche le catalogue vivant ; la fiche shared-cart affiche le snapshot.
- Une unité vendable = un SKU.
- `modal-selection-model.js` est l'unique owner de l'état de sélection SKU.
- Mobile et desktop doivent lire le même état dérivé.
- Le mobile SKU ne lit pas un stock autonome de couleur/taille.
- Les médias sont dérivés uniquement depuis les associations explicites du contrat.
- Le frontend ne décide jamais d'un rail ni d'un délai universel.
- Une quantité SKU modal cible la ligne panier exacte `product_id + variant_combo`.
- `b-modal-core.js` reste owner du lifecycle.
- Le guard MutationObserver PDC-4 est temporaire et doit mourir avec le fetch variante legacy à PDC-6.
- `b-modal-desktop-enhancers.js` reste un enhancer de composition, jamais un second moteur produit.
