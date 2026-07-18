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

Elle est distincte de la fiche article lecture seule du panier partagé, construite depuis le snapshot dans `b-group-view.js`.

```text
Catalogue vivant → modal produit globale enrichie.
Panier partagé participant → fiche snapshot lecture seule.
```

> **Une intelligence produit. Deux compositions responsive.**

Mobile et desktop consomment le même contrat détail et le même état de sélection. Ils organisent l'écran différemment ; ils ne possèdent jamais deux logiques de stock, prix, médias ou livraison.

---

## 2. Chaîne active PDC-5

```text
GET /api/products/:id/detail
        ↓
b-modal-product-detail-bootstrap.js
        ↓
createModalSelection(detail)
        ↓
state.modalProductDetail
state.modalSelection
        ↓
┌─────────────────────────────┬──────────────────────────────┐
│ mobile                      │ desktop                      │
│ b-modal-mobile-product.js   │ b-modal-desktop-product.js   │
│ PDC-4                       │ PDC-5                        │
└─────────────────────────────┴──────────────────────────────┘
```

Le contrat fournit :

```text
product
pricing
media
option_axes
sellable_units
delivery_options
```

`product_variants` décrit les axes de sélection. `product_skus` décrit les unités vendables et porte la vérité de stock en mode SKU.

### Une seule ouverture produit

`b-modal-product-detail-bootstrap.js` possède le chargement du contrat détail pour **les deux viewports**.

Il :

1. reçoit `modal:opened` ;
2. charge `GET /api/products/:id/detail` ;
3. ignore une réponse devenue obsolète après navigation produit ;
4. crée une seule sélection initiale ;
5. choisit uniquement le renderer responsive ;
6. nettoie l'état au `modal:closed`.

Il est interdit de recréer un fetch Product Detail mobile et un fetch Product Detail desktop.

`b-modal-mobile-product-bootstrap.js` est un alias de compatibilité temporaire. Il ne possède plus de fetch ni d'état.

---

## 3. Owners actifs

### JS

| Zone | Owner |
|---|---|
| Façade publique / compatibilité ouverture | `public/boutique/js/b-modal.js` |
| Cycle legacy modal, body lock, topbar, historique | `public/boutique/js/b-modal-core.js` — dette transitoire PDC-6 |
| Fetch Product Detail responsive | `public/boutique/js/b-modal-product-detail-bootstrap.js` |
| État dérivé de sélection SKU | `public/boutique/js/view-models/modal-selection-model.js` |
| Composition produit mobile | `public/boutique/js/b-modal-mobile-product.js` |
| Composition produit desktop | `public/boutique/js/b-modal-desktop-product.js` |
| Images, carousel, compteur, lightbox fullscreen, **Voir en grand** | `public/boutique/js/b-modal-image-ux.js` |
| Navigation / partage / trust / récemment vus desktop | `public/boutique/js/b-modal-desktop-enhancers.js` — no-op depuis T-016/D-P1 (bloc retiré du panneau commercial) |
| Placement actions + UI paiement hybride desktop | `public/boutique/js/b-modal-approche-c-hybrid.js` — désactivé sur PDP depuis T-016/D-P1 (non importé par `main.js` ; module conservé, non appelé) |
| Social proof conditionnel | `public/boutique/js/b-modal-social-proof.js` |
| Navigation produit précédent/suivant | `public/boutique/js/b-modal-nav.js` |
| Suggestions / recommandations | `public/boutique/js/b-modal-suggestions.js` |
| Intégration panier personnel depuis la modal | `public/boutique/js/b-modal-cart.js` |
| Renderer produit legacy | `public/boutique/js/b-modal-product.js` — compatibilité jusqu'à PDC-6 |
| Classes structurelles ViewModel legacy | `public/boutique/js/view-models/modal-view-model.js` — compatibilité jusqu'à PDC-6 |

### CSS

| Zone | Owner |
|---|---|
| Shell / overlay / topbar / scroll / actions | `public/boutique/css/modal-shell.css` |
| Images / carousel / media / bouton **Voir en grand** | `public/boutique/css/modal-media.css` |
| Informations produit / sélection / prix / actions | `public/boutique/css/modal-product.css` |
| Composition PDP hybride desktop | `public/boutique/css/modal-product-lot4-hybrid.css` |

Ancien `modal.css` monolithique : historique. Ne pas le recréer.

---

## 4. Doctrine de sélection SKU

> **Une unité vendable = un SKU.**

La modal sélectionne un `sku_id`. Elle ne maintient pas une vérité de stock séparée par couleur et par taille.

```text
Marron + S → SKU A → disponible
Marron + M → SKU B → disponible
Marron + L → SKU C → rupture
Beige  + L → SKU D → disponible
```

Après `Couleur = Marron` :

```text
L indisponible pour Marron — rupture de stock
```

### Owner unique

`modal-selection-model.js` possède :

```text
selected_options
selected_sku_id
selected_media
option_states
selection_message
```

États d'option :

```text
AVAILABLE
OUT_OF_STOCK
INCOMPATIBLE
```

Changer un axe amont efface les choix aval dans l'ordre de `option_axes`.

Exemple :

```text
Marron + M
    ↓ changement Couleur
Beige
    ↓
Taille effacée
```

### Produit legacy

```text
inventory_model = LEGACY_VARIANTS
        ↓
selection_supported = false
```

Aucun renderer ne transforme des axes legacy en faux SKU.

### Interdit

- décider dans `_buildSizeGrid()` qu'une taille est disponible via `opt.stock` ;
- reconstruire couleur × taille dans un renderer ;
- créer deux reducers mobile/desktop ;
- utiliser `variant_combo` comme vérité de stock frontend ;
- choisir un SKU silencieusement alors que la sélection reste ambiguë ;
- masquer une rupture explicable.

`state.modalVariantCombo` reste temporairement une **copie lisible de `selected_options`** pour la compatibilité transactionnelle actuelle. Il ne dérive aucune disponibilité.

---

## 5. Doctrine média

La modal rend les médias reçus. Elle ne déduit jamais une association depuis :

- le nom du fichier ;
- l'ordre de l'image ;
- une couleur dominante ;
- le viewport.

### Mobile PDC-4

- galerie swipe ;
- compteur `N/N` dès deux médias pour une fiche détail enrichie ;
- vignettes couleur photo depuis `thumbnail_url` ;
- galerie reconstruite depuis `selected_media` ;
- `setupImageUX()` relit les slides après reconstruction ;
- bouton **Voir en grand** et fullscreen restent propriétaires de `b-modal-image-ux.js`.

Le seuil legacy historique du compteur reste distinct tant que PDC-6 n'a pas éteint l'ancien chemin.

### Desktop PDC-5

- galerie à gauche ;
- Buy Box à droite ;
- même `selected_media` que mobile ;
- changement d'option → même reducer → nouvelle galerie ;
- aucune reconstruction média dans `b-modal-desktop-enhancers.js`.

Le desktop n'est pas un mobile agrandi. Le média reste cependant la même vérité produit.

---

## 6. Doctrine livraison

La modal rend :

```text
delivery_options[]
```

Chaque option peut porter :

```text
code
label
available
price_kmf
eta_label
unavailable_reason
```

Le frontend ne contient pas une liste fixe `STANDARD / EXPRESS`.

Aujourd'hui, `AIR_EXPRESS` reste absent tant qu'il n'est pas commercialement exposable par les moteurs propriétaires.

Demain, lorsque le contrat fournit Standard et Express, **les deux renderers les affichent sans nouvelle doctrine**.

### Absence honnête

```text
price_kmf = null
eta_label = null
```

n'autorise aucun fallback :

```text
Gratuit
3 à 5 semaines
```

### Owners de rendu

- mobile : `b-modal-mobile-product.js` ;
- desktop : `b-modal-desktop-product.js`.

### Placement DOM (desktop)

Depuis T-016/D4 pt.3, `#k-modal-delivery` et `#k-modal-payment` sont
positionnés dans `index.html` **sous** `#k-modal-suggestions` (pleine largeur,
hors colonne `.k-modal-info`). Les IDs et le peuplement (`getElementById`)
sont inchangés — seule la position DOM a bougé. Layout/position owned
`modal-shell.css` ; contenu interne (options, badges…) reste owned
`modal-product.css`.

Le sous-total sticky desktop (`.k-modal-subtotal`) est masqué depuis
T-016/D4 pt.4 (`display: none` dans `modal-shell.css`, `@media (min-width: 900px)`)
: seconde source transactionnelle jugée redondante avec le panier, hors
périmètre panier lui-même (non touché).

### Interdit

- `product.delivery_delay || '3 à 5 semaines'` ;
- « Point relais · Gratuit · 3 à 5 semaines » dans un enhancer ;
- déduire Express depuis poids, produit ou viewport ;
- rendre la livraison produit depuis `b-modal-approche-c-hybrid.js` ;
- rendre la livraison produit depuis `b-modal-desktop-enhancers.js`.

---

## 7. Composition mobile PDC-4

```text
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

- le choix couleur rafraîchit les autres axes depuis le reducer unique ;
- une rupture est expliquée dans le contexte de la sélection ;
- la galerie suit `selected_media` ;
- Ajouter/Acheter restent désactivés en mode SKU sans `selected_sku_id` ;
- aucune bottom-sheet ne possède une seconde logique de taille.

---

## 8. Composition desktop PDC-5

```text
┌─────────────────────────┬──────────────────────────┐
│                         │  Nom / Référence         │
│     GALERIE / MÉDIAS    │  Prix / Promotion       │
│                         │                          │
│   média dominant        │  Couleurs photo          │
│   carousel / fullscreen │  Tailles combo-aware     │
│                         │  disponibilité expliquée │
│                         │                          │
│                         │  Livraison(s) publique(s)│
│                         │  Quantité                │
│                         │  Sous-total              │
│                         │  AJOUTER / ACHETER        │
└─────────────────────────┴──────────────────────────┘

       navigation / partage / trust / récemment vus dessous
```

### `b-modal-desktop-product.js`

Possède le rendu transactionnel desktop :

- identité ;
- prix produit ou prix du SKU sélectionné ;
- ancien prix uniquement depuis `old_price_kmf` ;
- référence SKU sélectionnée ;
- disponibilité depuis `state.modalSelection` ;
- axes ;
- raison d'indisponibilité ;
- livraison depuis `delivery_options` ;
- sous-total `prix courant × modalQty` ;
- galerie depuis `selected_media`.

Il ne calcule aucune vérité métier nouvelle.

### `b-modal-desktop-enhancers.js`

**Désactivé sur PDP depuis T-016/D-P1** — `onModalOpened()` est un no-op ;
les injecteurs de breadcrumb, partage, trust générique et récemment vus ont
été retirés du module (dette de code résiduelle : les abonnements bus restent
idempotents, cf. MDP-3). Documentation des anciennes responsabilités
conservée à titre historique — n'est plus vraie tant que D-P1 tient :

- breadcrumb ;
- partage ;
- trust générique ;
- récemment vus.

Il reste interdit qu'un futur enhancer reconstruise :

- prix ;
- ancien prix ;
- économie EUR ;
- stock ;
- rareté ;
- livraison ;
- sous-total ;
- disponibilité variante.

### `b-modal-approche-c-hybrid.js`

**Désactivé sur PDP depuis T-016/D-P1** — non importé/appelé par `main.js`.
Le module et ses tests sont conservés (dormants), mais ne s'exécutent plus
au runtime PDP. Ancien périmètre de composition (n'est plus vrai tant que
D-P1 tient) :

- placement des actions ;
- garde minimale de quantité ;
- UI de choix paiement ;
- entrée partage existante.

Il ne rendait déjà plus :

- livraison produit ;
- sous-total produit.

---

## 9. Transition jusqu'à PDC-6

`b-modal-core.js` lance encore le fetch legacy `/api/products/:id` et peut repeindre tardivement `#k-modal-variants`.

PDC-4/PDC-5 utilisent temporairement un guard de repaint dans :

```text
b-modal-product-detail-bootstrap.js
```

Il vérifie seulement que le root attendu existe :

```text
mobile  → [data-pdc4-root]
desktop → [data-pdc5-root]
```

Si le renderer legacy remplace ce root, le guard rerend depuis :

```text
state.modalProductDetail
state.modalSelection
```

Le guard :

- ne charge pas un second contrat ;
- ne recalcule aucun stock ;
- ne recrée aucune sélection ;
- doit disparaître en PDC-6 avec le fetch legacy.

Autres dettes transitoires PDC-6 :

- alias `b-modal-mobile-product-bootstrap.js` ;
- `_renderVariants()` legacy ;
- classes structurelles de `modal-view-model.js` si elles ne sont plus nécessaires après confrontation runtime.

---

## 10. Cas sensible : Voir en grand

Owner fonctionnel : `public/boutique/js/b-modal-image-ux.js`.

Owner CSS : `public/boutique/css/modal-media.css`.

Invariants :

- **Voir en grand** est injecté dans la zone média ;
- fullscreen appartient à `b-modal-image-ux.js` ;
- position/layout appartiennent à `modal-media.css` ;
- les renderers responsive reconstruisent le carousel puis appellent `setupImageUX()` ;
- ne pas corriger ce parcours depuis `b-catalog.js`, `products.css` ou `boutique-desktop.css`.

---

## 11. Règles de modification

### JS

| Besoin | Owner |
|---|---|
| Fetch Product Detail / cycle d'état responsive | `b-modal-product-detail-bootstrap.js` |
| Disponibilité / SKU / média dérivé | `view-models/modal-selection-model.js` |
| Composition mobile | `b-modal-mobile-product.js` |
| Composition desktop transactionnelle | `b-modal-desktop-product.js` |
| Carousel / compteur / fullscreen | `b-modal-image-ux.js` |
| Navigation / partage / trust / récemment vus desktop | `b-modal-desktop-enhancers.js` — no-op depuis T-016/D-P1 |
| Placement actions / UI paiement hybride | `b-modal-approche-c-hybrid.js` — désactivé sur PDP depuis T-016/D-P1 |
| Suggestions | `b-modal-suggestions.js` |
| Panier depuis modal | `b-modal-cart.js` |

La modal produit ne doit pas posséder :

- le pager catégories ;
- le hero ;
- la fiche snapshot shared-cart ;
- la décision de rail ;
- le pricing transport ;
- la vérité de stock.

### CSS

- overlay/topbar/actions → `modal-shell.css` ;
- image/carousel/media/**Voir en grand** → `modal-media.css` ;
- infos produit/prix/sélection/actions → `modal-product.css` ;
- composition hybride desktop → `modal-product-lot4-hybrid.css`.

Après modification CSS :

```bash
cd public/boutique
npm run deploy:css
npm run check:cache
npm run audit:arch
```

---

## 12. Invariants de revue

- La modal catalogue affiche le catalogue vivant ; shared-cart affiche son snapshot.
- Une unité vendable = un SKU.
- Un seul fetch Product Detail alimente les deux viewports.
- Un seul reducer dérive l'état de sélection.
- Mobile et desktop lisent le même `state.modalSelection`.
- Les médias viennent d'associations explicites.
- Le frontend ne décide jamais d'un rail ni d'un délai de livraison.
- Le desktop ne possède plus de second moteur produit dans ses enhancers.
- Pas de CSS stable injecté par JS.
- Le guard legacy est une dette PDC-6 ; ne pas l'étendre.

---

## 13. Tests

Après modification modal :

```bash
cd public/boutique
npm run check:html
npm run check:imports
npm run check:body-classes
npm run audit:arch
```

Depuis la racine :

```bash
npm run gate:boutique-ownership
npm run map:check
```

Scénarios métier obligatoires :

1. couleur A + taille disponible → même `sku_id` mobile et desktop ;
2. couleur A + taille en rupture → `OUT_OF_STOCK` + raison ;
3. couleur B rend la même taille disponible → état rafraîchi ;
4. combinaison inexistante → `INCOMPATIBLE` ;
5. sélection partielle → aucun SKU choisi silencieusement ;
6. produit sans variante → SKU par défaut ;
7. média associé à une couleur → même galerie dérivée mobile/desktop ;
8. absence d'Express dans `delivery_options` → aucune UI Express inventée ;
9. `old_price_kmf = null` → aucun ancien prix reconstruit depuis la promotion ;
10. quantité desktop modifiée → sous-total recalculé depuis le prix courant du contrat/SKU ;
11. enhancer desktop → aucun write prix/stock/livraison/sous-total ;
12. repaint legacy tardif → root responsive restauré depuis l'état partagé pendant la transition PDC-6.

---

## 12. MDM — Composition canonique mobile v3

> **Mis à jour : 2026-07-16** — Phase 1 implémentée.

### 12.1 Principes

La modal mobile est une **fiche produit transactionnelle**. Elle répond à sept questions dans un seul écran : qu'est-ce que c'est, combien ça coûte, quelle variante, est-elle disponible, comment être livré, quelle quantité, et ajouter ou acheter.

Elle n'est pas une démonstration de toutes les capacités de Komerce.

### 12.2 Composition canonique v3

```text
TOPBAR (sticky shell existant)
├── ← Retour / Catalogue
├── 🛒 badge panier
└── ✕ fermer

MEDIA (48vh max, aspect natif)
├── Carousel swipe
├── Badge promo -N% (si pricing.promo_pct > 0)
├── Voir en grand
└── Compteur 1/N

IDENTITY COMPACT (card overlap sur media)
├── Nom (2 lignes max, -webkit-line-clamp)
├── Réf. inline
├── Prix actuel (coral si promo)
├── Ancien prix barré (uniquement si old_price_kmf != null)
└── Tag promo -N% inline

OPTIONS (dans #k-modal-variants)
├── Couleur · [selected] — thumbnails si disponibles
├── Taille · [selected] — boutons
├── Message sélection (rupture/incompatibilité)
└── Autres axes si présents

INFO STRIP (chips horizontaux, une seule ligne)
├── ✓ Disponible (ou message de guidance)
├── 📦 [delivery_options[0].label]  — JAMAIS hardcodé
└── ✈️ [delivery_options[1].label]  — JAMAIS hardcodé

── FOLD (séparateur 3px) ──

DESCRIPTION (tronquée 3 lignes + Lire la suite)
DÉTAILS (composition, entretien — si disponibles)

STICKY CTA BAR (fixed bottom, shell existant)
├── [−] qty [+]
├── 🛒 Panier
└── ⚡ Acheter
```

### 12.3 Éléments retirés du mobile (MDM-8)

| Élément | Raison | Destination |
|---|---|---|
| Sous-total | Prix + quantité suffisent sur fiche produit | Supprimé du mobile |
| Sélecteur paiement (Carte/Cash/Panier/Cagnotte) | Appartient au parcours déclenché après "Acheter" | Purchase flow |
| Reassurance hardcodée | Remplacée par info strip dynamique | Supprimée |
| Description dans zone identité | Polluait le premier écran transactionnel | Below fold |

### 12.4 Fichiers MDM

| Rôle | Fichier |
|---|---|
| Renderer mobile canonical | `public/boutique/js/b-modal-mobile-product.js` |
| CSS canonical mobile | `public/boutique/css/modal-mobile-canonical.css` |
| CSS price normalization | `public/boutique/css/modal-product-price-normalization.css` — vidé, remplacé par canonical |
| Tests | `tests/unit/modal-mobile-canonical.test.js` |
| Bundle CSS | `components.css` via `css-bundles.js` |

### 12.5 Règles de layout MDM

1. Titre limité à 2 lignes visuelles, jamais de hauteur magique.
2. Média plafonné à `48vh`, min `180px`.
3. CTA sticky `position: fixed` en bas — jamais dans le flux scrollable.
4. Info strip : dispo + delivery chips en ligne horizontale, pas empilés.
5. Description hors premier écran, sous séparateur fort.
6. Zéro label livraison hardcodé — `delivery_options[]` exclusivement.
7. Fonctionne de 320px à 428px de largeur sans recalcul.
