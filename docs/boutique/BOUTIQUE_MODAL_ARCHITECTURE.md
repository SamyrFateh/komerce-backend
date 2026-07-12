# Boutique — Architecture modal produit

> Mis à jour : **2026-07-12**  
> Statut : document actif pour modifier la modal produit Boutique.  
> Doctrine amont obligatoire : `../doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md`.

---

## 1. Rôle

La modal produit est la **fiche produit transactionnelle de Komerce** pour le catalogue vivant.

Elle permet au client de :

- comprendre visuellement le produit et ses mises en scène ;
- voir son identité, son prix et sa promotion ;
- sélectionner une unité réellement vendable ;
- comprendre immédiatement pourquoi une option est indisponible ;
- voir les options de livraison commercialement exposées ;
- choisir une quantité ;
- ajouter ou acheter.

Elle est distincte de la fiche article lecture seule du panier partagé, qui est construite depuis le snapshot dans `b-group-view.js`.

Règle Boutique First :

```txt
Catalogue vivant → modal produit globale enrichie.
Panier partagé participant → fiche snapshot lecture seule.
```

Ne pas mélanger ces deux vérités.

Règle responsive :

> **Une intelligence produit. Deux compositions responsive.**

Mobile et desktop consomment le même contrat détail et le même état de sélection. Ils peuvent organiser l'écran différemment ; ils ne possèdent jamais deux logiques de stock, prix, médias ou livraison.

---

## 2. Entrée de la modal

La cible est un contrat détail produit public, versionné et whitelisté, conforme à `DOCTRINE_PRODUCT_DETAIL_CONTRACT.md`.

La modal ne doit pas dépendre durablement du produit de liste brut stocké dans `state.products` pour rendre les vérités transactionnelles.

Chaîne cible :

```txt
GET détail produit
      ↓
product_detail contract
      ↓
ModalViewModel / état de sélection unique
      ↓
renderers modal
      ↓
mobile / desktop
```

Le contrat fournit notamment :

```txt
identity
pricing
media
option_axes
sellable_units
 delivery_options
```

`product_variants` décrit les axes de sélection. `product_skus` décrit les unités vendables et porte la vérité de stock en mode SKU.

---

## 3. Owners actifs

### JS

| Zone | Owner |
|---|---|
| Façade publique / compatibilité ouverture | `public/boutique/js/b-modal.js` |
| Cycle ouverture/fermeture, fetch détail, body lock, topbar, historique | `public/boutique/js/b-modal-core.js` |
| Contrat d'affichage et état dérivé de sélection | `public/boutique/js/view-models/modal-view-model.js` **ou remplacement explicitement acté au Lot PDC-3** |
| Rendu contenu produit et interactions de sélection | `public/boutique/js/b-modal-product.js` |
| Images, carousel, compteur, lightbox fullscreen, bouton **Voir en grand** | `public/boutique/js/b-modal-image-ux.js` |
| Social proof conditionnel | `public/boutique/js/b-modal-social-proof.js` |
| Navigation produit précédent/suivant | `public/boutique/js/b-modal-nav.js` |
| Suggestions / recommandations dans la modal | `public/boutique/js/b-modal-suggestions.js` |
| Intégration panier personnel depuis la modal | `public/boutique/js/b-modal-cart.js` |
| Composition et enrichissements desktop | `public/boutique/js/b-modal-desktop-enhancers.js` |

### CSS

| Zone | Owner |
|---|---|
| Shell / overlay / topbar / scroll / actions | `public/boutique/css/modal-shell.css` |
| Images / carousel / media / bouton **Voir en grand** | `public/boutique/css/modal-media.css` |
| Informations produit / sélection / prix / actions | `public/boutique/css/modal-product.css` |
| Extension PDP hybride desktop | `public/boutique/css/modal-product-lot4-hybrid.css` |

Ancienne doc ou ancien fichier `modal.css` monolithique : historique. Ne pas l'utiliser comme source de vérité si le code actuel est split en `modal-*`.

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

Après sélection `Couleur = Marron`, la taille `L` doit être présentée comme indisponible pour cette sélection, avec une raison compréhensible :

```txt
L indisponible pour Marron — rupture de stock
```

### État de sélection unique

L'état dérivé de sélection possède :

```txt
selected_options
selected_sku_id
selected_media
option_states
selection_message
```

`option_states` utilise des états explicites :

```txt
AVAILABLE
OUT_OF_STOCK
INCOMPATIBLE
```

Le mobile et le desktop lisent le même état.

### Interdit

- décider dans `_buildSizeGrid()` qu'une taille est disponible uniquement via `opt.stock` de l'axe Taille ;
- reconstruire une matrice couleur × taille dans deux renderers ;
- faire de `variant_combo` le canal de vérité du stock cible ;
- choisir un SKU silencieusement alors que la sélection utilisateur reste ambiguë ;
- masquer une rupture sans raison lorsque le contrat fournit un état explicable.

---

## 5. Doctrine média / mises en scène

La zone média n'est plus une simple photo produit unique.

Le contrat peut fournir :

- image produit principale ;
- vues complémentaires ;
- mises en scène ;
- médias associés à une couleur ou à un SKU.

La modal rend les médias reçus. Elle ne devine pas qu'une image appartient à « Marron » depuis son nom de fichier ou son ordre.

### Mobile

- galerie swipe ;
- compteur `N/N` ;
- média dominant ;
- libellé éditorial éventuel fourni par le contrat ;
- bouton **Voir en grand** géré par `b-modal-image-ux.js`.

Les vignettes couleur utilisent une image réelle du produit lorsque `thumbnail_url` est fourni par le contrat. Pas de fallback hex inventé.

### Desktop

- galerie à gauche ;
- miniatures / navigation média ;
- Buy Box à droite ;
- même sélection média dérivée que le mobile.

Le desktop n'est pas un mobile agrandi. Le média reste cependant la même vérité produit.

---

## 6. Doctrine livraison

La modal sait rendre une liste d'options de livraison. Elle ne décide jamais d'un rail.

Entrée :

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

Le frontend ne contient pas une liste fixe `STANDARD / EXPRESS`.

Aujourd'hui, `AIR_EXPRESS` est connu par `logistics` mais n'est pas commercialement exposable. Il ne doit donc pas être présenté comme promesse client.

Demain, lorsque les moteurs propriétaires exposent Standard et Express, la modal affiche les deux **sans changer sa doctrine**.

### Interdit

- `product.delivery_delay || '3 à 5 semaines'` comme vérité universelle ;
- injecter « Point relais · Gratuit · 3 à 5 semaines » depuis `b-modal-desktop-enhancers.js` sans contrat backend ;
- déduire Express depuis le poids, le produit ou le viewport dans le frontend ;
- afficher un prix ou un délai Express tant que `logistics` et `economic-engine` ne l'ont pas rendu commercialement exposable.

---

## 7. Composition mobile cible

Ordre fonctionnel cible :

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

Invariants mobile :

- ne pas casser le scroll ni les actions visibles ;
- le choix couleur rafraîchit l'état des autres axes depuis le reducer unique ;
- une rupture est expliquée dans le contexte de la sélection ;
- la galerie suit les médias associés quand le contrat les fournit ;
- aucune logique métier n'est dupliquée dans une bottom-sheet de taille.

---

## 8. Composition desktop cible

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
│                         │  AJOUTER / ACHETER        │
└─────────────────────────┴──────────────────────────┘

       détails / éditorial / suggestions dessous
```

`b-modal-desktop-enhancers.js` peut améliorer la composition desktop : breadcrumb, partage, détails, récemment vus, placement Buy Box.

Il ne doit plus reconstruire lui-même :

- le prix commercial ;
- le stock ;
- la disponibilité variante ;
- les options de livraison ;
- un délai de transport.

Ces informations viennent du contrat / ViewModel.

---

## 9. Cas sensible : Voir en grand mobile

Owner fonctionnel : `public/boutique/js/b-modal-image-ux.js`.

Owner CSS : `public/boutique/css/modal-media.css`.

Orchestrateur : `public/boutique/js/b-modal-core.js`.

Invariants :

- le bouton **Voir en grand** est injecté dans la zone media de la modal produit ;
- le fullscreen image appartient à `b-modal-image-ux.js`, pas au catalogue ;
- le layout et la position du bouton appartiennent à `modal-media.css` ;
- ne pas corriger ce parcours depuis `public/boutique/js/b-catalog.js`, `public/boutique/css/products.css` ou `public/boutique/css/boutique-desktop.css`.

---

## 10. Règles de modification

### JS

Modifier le fichier owner de la zone touchée :

- ouverture/fermeture/fetch détail → `public/boutique/js/b-modal-core.js` ;
- sélection et contrat d'affichage → owner ViewModel/reducer unique ;
- rendu produit catalogue → `public/boutique/js/b-modal-product.js` ;
- image, carousel, lightbox, **Voir en grand** → `public/boutique/js/b-modal-image-ux.js` ;
- suggestions → `public/boutique/js/b-modal-suggestions.js` ;
- panier depuis modal → `public/boutique/js/b-modal-cart.js` ;
- composition desktop → `public/boutique/js/b-modal-desktop-enhancers.js`.

La modal produit ne doit pas posséder :

- le pager catégories ;
- le hero ;
- le panier partagé participant ;
- la fiche snapshot lecture seule ;
- la décision de rail ;
- le pricing transport ;
- la vérité de stock.

### CSS

Modifier le fichier CSS owner :

- structure overlay/topbar/actions → `public/boutique/css/modal-shell.css` ;
- image/carousel/media/**Voir en grand** → `public/boutique/css/modal-media.css` ;
- infos produit/prix/sélection/actions → `public/boutique/css/modal-product.css` ;
- enrichissement hybride desktop → `public/boutique/css/modal-product-lot4-hybrid.css`.

Après modification CSS :

```bash
cd public/boutique
npm run deploy:css
npm run check:cache
npm run audit:arch
```

---

## 11. Invariants

- La modal catalogue affiche le catalogue vivant ; la fiche shared-cart affiche le snapshot.
- Une unité vendable = un SKU ; les axes ne portent pas une vérité de stock indépendante.
- Un seul owner dérive l'état de sélection pour mobile et desktop.
- Les médias sont rendus depuis leurs associations explicites ; aucune déduction depuis le nom de fichier.
- Le frontend ne décide jamais d'un rail ni d'un délai de livraison.
- Mobile : ne pas casser le scroll ni les actions visibles.
- Desktop : ne pas corriger un problème de layout global depuis la modal.
- Pas de CSS stable injecté par JS.
- Pas de sélecteurs `.k-modal-*` dispersés hors fichiers modal owners sans raison documentée.
- Toute modification du parcours **Voir en grand** passe par `b-modal-image-ux.js` et `modal-media.css`.
- `b-modal-desktop-enhancers.js` reste un enhancer de composition, jamais un second moteur produit.

---

## 12. Tests

Après modification modal :

```bash
cd public/boutique
npm run check:html
npm run check:imports
npm run check:body-classes
npm run audit:arch
```

Depuis la racine repo :

```bash
npm run gate:boutique-ownership
npm run map:check
```

Tests métier de sélection obligatoires au Lot PDC-3 :

1. couleur A + taille disponible → SKU précis ;
2. couleur A + taille en rupture → `OUT_OF_STOCK` + raison ;
3. couleur B rend la même taille disponible → état rafraîchi ;
4. combinaison inexistante → `INCOMPATIBLE` ;
5. sélection partielle → aucun SKU choisi silencieusement ;
6. produit sans variante → SKU par défaut ;
7. média associé à une couleur → galerie rafraîchie ;
8. absence d'Express dans `delivery_options` → aucune UI Express inventée.

Tests manuels :

1. ouvrir une fiche produit depuis la grille mobile ;
2. swiper les médias et vérifier le compteur ;
3. changer de couleur et vérifier médias + tailles ;
4. vérifier une taille indisponible avec raison contextuelle ;
5. ouvrir le fullscreen image puis le fermer ;
6. vérifier les options de livraison réellement reçues ;
7. ajouter au panier avec le `sku_id` sélectionné ;
8. ouvrir la même fiche desktop et retrouver la même disponibilité ;
9. fermer et retrouver le scroll correct ;
10. vérifier que la fiche lecture seule du panier partagé n'a pas été changée par erreur.
