# Boutique — Architecture modal produit

> Mis à jour : **2026-07-12**  
> Statut : document actif pour modifier la modal produit Boutique.  
> Doctrine amont obligatoire : `../doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md`.

---

## 1. Rôle

La modal produit est la **fiche produit transactionnelle de Komerce** pour le catalogue vivant.

Elle permet au client de comprendre visuellement le produit, voir son identité et son prix, sélectionner une unité réellement vendable, comprendre une indisponibilité, voir les options de livraison commercialement exposées, choisir une quantité et déclencher Ajouter / Acheter.

Elle reste distincte de la fiche article lecture seule du panier partagé, construite depuis le snapshot dans `b-group-view.js`.

```txt
Catalogue vivant → modal produit globale enrichie.
Panier partagé participant → fiche snapshot lecture seule.
```

Règle responsive :

> **Une intelligence produit. Deux compositions responsive.**

Mobile et desktop consomment le même contrat détail et le même état de sélection. Ils peuvent organiser l'écran différemment ; ils ne possèdent jamais deux logiques de stock, prix, médias ou livraison.

---

## 2. Entrée de la modal

La cible consomme le Product Detail Contract v1 :

```txt
GET /api/products/:id/detail
      ↓
product_detail_v1
      ↓
modal-selection-model.js
      ↓
renderers modal
      ↓
mobile / desktop
```

Le contrat fournit :

```txt
product
pricing
media
option_axes
sellable_units
delivery_options
```

La modal ne doit pas dépendre durablement du produit de liste brut de `state.products` pour rendre les vérités transactionnelles.

`product_variants` décrit les axes. `product_skus` décrit les unités vendables et porte la vérité de stock en mode SKU. La Boutique ne lit directement ni l'une ni l'autre table : elle consomme le contrat public.

---

## 3. Owners actifs

### JS

| Zone | Owner |
|---|---|
| Façade publique / compatibilité ouverture | `public/boutique/js/b-modal.js` |
| Cycle ouverture/fermeture, fetch détail, body lock, topbar, historique | `public/boutique/js/b-modal-core.js` |
| **État dérivé de sélection SKU** | `public/boutique/js/view-models/modal-selection-model.js` |
| Contrat d'affichage legacy / classes historiques pendant convergence | `public/boutique/js/view-models/modal-view-model.js` |
| Rendu contenu produit et interactions de sélection | `public/boutique/js/b-modal-product.js` |
| Images, carousel, compteur, lightbox fullscreen, bouton **Voir en grand** | `public/boutique/js/b-modal-image-ux.js` |
| Social proof conditionnel | `public/boutique/js/b-modal-social-proof.js` |
| Navigation produit précédent/suivant | `public/boutique/js/b-modal-nav.js` |
| Suggestions / recommandations dans la modal | `public/boutique/js/b-modal-suggestions.js` |
| Intégration panier personnel depuis la modal | `public/boutique/js/b-modal-cart.js` |
| Composition et enrichissements desktop | `public/boutique/js/b-modal-desktop-enhancers.js` |

### Décision PDC-3

`modal-selection-model.js` est l'**unique owner de la sélection SKU cible**.

`modal-view-model.js` n'est pas étendu pour porter une deuxième logique SKU. Il garde temporairement ses responsabilités historiques de normalisation produit brut et classes contractuelles jusqu'à PDC-6.

La convergence est donc explicite :

```txt
modal-view-model.js
= legacy display compatibility

modal-selection-model.js
= sélection SKU cible unique
```

PDC-4/PDC-5 branchent les renderers sur le reducer. PDC-6 retire les lectures métier legacy et réévalue alors la forme finale du ViewModel d'affichage.

### CSS

| Zone | Owner |
|---|---|
| Shell / overlay / topbar / scroll / actions | `public/boutique/css/modal-shell.css` |
| Images / carousel / media / bouton **Voir en grand** | `public/boutique/css/modal-media.css` |
| Informations produit / sélection / prix / actions | `public/boutique/css/modal-product.css` |
| Extension PDP hybride desktop | `public/boutique/css/modal-product-lot4-hybrid.css` |

---

## 4. Doctrine de sélection SKU

> **Une unité vendable = un SKU.**

La modal sélectionne un `sku_id`. Elle ne maintient pas une vérité de stock séparée par couleur et par taille.

Exemple :

```txt
Marron + S → SKU A → disponible
Marron + M → SKU B → disponible
Marron + L → SKU C → rupture
Beige  + L → SKU D → disponible
```

Au départ, `L` peut être globalement `AVAILABLE` parce que `Beige + L` est disponible.

Après sélection :

```txt
Couleur = Marron
```

le reducer recalcule l'axe suivant depuis les `sellable_units` compatibles :

```txt
S → AVAILABLE
M → AVAILABLE
L → OUT_OF_STOCK
```

Un clic sur `L` ne modifie pas la sélection et produit :

```txt
L indisponible pour Marron — rupture de stock
```

Une combinaison absente produit :

```txt
S indisponible pour Beige — combinaison non proposée
```

### État public du reducer

```txt
inventory_model
selection_supported
selected_options
selected_sku_id
selected_media
option_states
selection_message
```

`option_states` utilise uniquement :

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

Changer un axe amont efface les choix des axes suivants.

Exemple :

```txt
Marron + M
   ↓ changement Couleur
Beige
```

La taille `M` n'est pas silencieusement conservée. L'état devient :

```txt
selected_options = { Couleur: "Beige" }
selected_sku_id = null
```

puis les tailles sont recalculées pour Beige.

### Sélection complète

`selected_sku_id` n'est posé que si :

1. tous les axes sont sélectionnés ;
2. une `sellable_unit` correspond exactement ;
3. son `stock_status` vaut `AVAILABLE`.

Aucune « première variante disponible » n'est choisie silencieusement pour compléter un choix utilisateur ambigu.

### Produit sans axes

Un produit SKU avec un SKU par défaut :

```txt
option_axes = []
option_values = {}
```

peut résoudre immédiatement `selected_sku_id` si l'unité est `AVAILABLE`.

### Produit legacy

Pour :

```txt
inventory_model = LEGACY_VARIANTS
```

le reducer retourne :

```txt
selection_supported = false
selected_sku_id = null
option_states = {}
```

Il reste passif. Il ne reconstruit aucun stock depuis `product_variants.stock`.

---

## 5. Doctrine média / mises en scène

La zone média peut contenir image principale, vues complémentaires, mises en scène et médias associés à une valeur d'option ou à un SKU.

Le reducer dérive `selected_media` selon l'ordre suivant :

```txt
1. media_ids du SKU sélectionné
2. médias dont option_values correspondent à la sélection courante
3. médias globaux option_values = {}
4. galerie complète comme fallback visuel
```

Aucune association n'est déduite depuis le nom de fichier, l'ordre d'une image ou sa couleur dominante.

### Mobile

- galerie swipe ;
- compteur `N/N` ;
- média dominant ;
- bouton **Voir en grand** géré par `b-modal-image-ux.js` ;
- vignettes couleur photo lorsque `thumbnail_url` est fourni.

### Desktop

- galerie à gauche ;
- miniatures / navigation média ;
- Buy Box à droite ;
- même `selected_media` dérivé que le mobile.

---

## 6. Doctrine livraison

La modal rend :

```txt
delivery_options[]
```

Chaque option publique peut porter :

```txt
code
label
available
price_kmf
eta_label
unavailable_reason
```

Le frontend ne possède pas une liste fixe Standard / Express.

`AIR_EXPRESS` ne doit pas être présenté tant que `logistics` ne l'expose pas commercialement. Un `price_kmf` ou `eta_label` nul reste nul tant qu'un moteur propriétaire ne fournit pas la vérité.

### Interdit

- `product.delivery_delay || '3 à 5 semaines'` comme vérité universelle ;
- « Point relais · Gratuit · 3 à 5 semaines » injecté par un enhancer ;
- Express déduit depuis le poids, le produit ou le viewport ;
- prix ou délai inventé par la Boutique.

---

## 7. Composition mobile cible — PDC-4

```txt
TOPBAR
MEDIA / MISES EN SCÈNE / SWIPE
IDENTITÉ + PRIX
OPTIONS VISUELLES COULEUR
TAILLE / POINTURE COMBO-AWARE
MESSAGE D'INDISPONIBILITÉ CONTEXTUEL
LIVRAISON(S) PUBLIQUE(S)
QUANTITÉ
AJOUTER / ACHETER — actions visibles/sticky
ENRICHISSEMENTS / SUGGESTIONS
```

Invariants :

- le choix d'un axe appelle le reducer unique ;
- le renderer lit `option_states`, il ne filtre pas lui-même les SKU ;
- une rupture est expliquée depuis `selection_message` ;
- la galerie lit `selected_media` ;
- le CTA transactionnel utilise `selected_sku_id` ;
- aucune logique métier n'est dupliquée dans une bottom-sheet de taille.

---

## 8. Composition desktop cible — PDC-5

```txt
┌─────────────────────────┬──────────────────────────┐
│                         │  Nom / Référence         │
│     GALERIE / MÉDIAS    │  Prix / Promotion       │
│                         │                          │
│   miniatures / scène    │  Couleurs photo          │
│   image dominante       │  Tailles combo-aware     │
│                         │  disponibilité expliquée │
│                         │                          │
│                         │  Livraison(s) publique(s)│
│                         │  Quantité                │
│                         │  AJOUTER / ACHETER       │
└─────────────────────────┴──────────────────────────┘
```

`b-modal-desktop-enhancers.js` peut améliorer la composition desktop. Il ne doit plus reconstruire prix, stock, disponibilité variante, options de livraison ou délai de transport.

---

## 9. Cas sensible : Voir en grand mobile

Owner fonctionnel : `public/boutique/js/b-modal-image-ux.js`.

Owner CSS : `public/boutique/css/modal-media.css`.

Orchestrateur : `public/boutique/js/b-modal-core.js`.

Le fullscreen image appartient au media UX. Il ne doit pas être corrigé depuis le catalogue, `products.css` ou `boutique-desktop.css`.

---

## 10. Règles de modification

### JS

- ouverture / fermeture / fetch détail → `b-modal-core.js` ;
- état de sélection SKU → `view-models/modal-selection-model.js` ;
- compatibilité d'affichage legacy → `view-models/modal-view-model.js` jusqu'à PDC-6 ;
- rendu produit → `b-modal-product.js` ;
- image / carousel / lightbox → `b-modal-image-ux.js` ;
- suggestions → `b-modal-suggestions.js` ;
- panier depuis modal → `b-modal-cart.js` ;
- composition desktop → `b-modal-desktop-enhancers.js`.

La modal ne possède pas le pager catégories, le hero, le panier partagé participant, la vérité de stock, la décision de rail ou le pricing transport.

### CSS

- overlay / topbar / actions → `modal-shell.css` ;
- image / carousel / media → `modal-media.css` ;
- infos produit / sélection / actions → `modal-product.css` ;
- enrichissement hybride desktop → `modal-product-lot4-hybrid.css`.

---

## 11. Invariants

- La modal catalogue affiche le catalogue vivant ; la fiche shared-cart affiche le snapshot.
- Une unité vendable = un SKU.
- `modal-selection-model.js` est l'unique owner de l'état de sélection SKU cible.
- Les axes ne portent pas une vérité de stock indépendante.
- Mobile et desktop lisent le même état dérivé.
- Les médias sont dérivés uniquement depuis les associations explicites du contrat.
- Le frontend ne décide jamais d'un rail ni d'un délai de livraison.
- Mobile : ne pas casser le scroll ni les actions visibles.
- Desktop : ne pas corriger un problème de layout global depuis la modal.
- Pas de CSS stable injecté par JS.
- Toute modification du parcours **Voir en grand** passe par `b-modal-image-ux.js` et `modal-media.css`.
- `b-modal-desktop-enhancers.js` reste un enhancer de composition, jamais un second moteur produit.

---

## 12. Tests

PDC-3 doit prouver au minimum :

1. disponibilité initiale agrégée depuis les unités réelles ;
2. couleur A + taille disponible → SKU précis ;
3. couleur A + taille en rupture → `OUT_OF_STOCK` + raison ;
4. couleur B rend la même taille disponible → état rafraîchi ;
5. combinaison inexistante → `INCOMPATIBLE` ;
6. sélection partielle → aucun SKU choisi silencieusement ;
7. changement d'axe amont → choix aval effacés ;
8. produit sans axe → SKU par défaut ;
9. produit legacy → `selection_supported=false` ;
10. média associé à une couleur / SKU → `selected_media` rafraîchi.

Après modification modal :

```bash
cd public/boutique
npm run check:imports
npm run audit:arch
npm run test:unit -- modal-selection-model.test.js
```

Depuis la racine :

```bash
npm run gate:boutique-ownership
npm run map:check
```

Les tests manuels d'interaction complète commencent à PDC-4 lorsque le renderer mobile consomme réellement le reducer.
