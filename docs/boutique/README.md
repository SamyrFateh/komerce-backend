# Boutique Komerce — Guide opératoire

> Mis à jour : **2026-08-05**  
> Statut : **point d'entrée actif pour toute modification Boutique**.

Ce document répond à quatre questions :

```txt
Quoi chercher ?
Où modifier ?
Comment valider ?
Quels invariants protéger ?
```

---

## 0. Doctrine graphe obligatoire

Avant de toucher `public/boutique/**`, lire :

```txt
docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md
docs/KOMERCE_ARCH_CARTOGRAPHY_STATUS.md
docs/KOMERCE_ARCH_HEADER_GRAPH.md
docs/komerce-arch-header-graph.json
```

Règle : aucun nouveau fichier Boutique ne doit être muet. Il doit avoir un header `@komerce-arch` ou être agrégé par `@komerce-arch-lite` avec `@owner`.

---

## 1. Vérité produit active — liste partageable

La liste partageable suit les doctrines suivantes :

```txt
La liste porte la sélection ; le message porte la cause.
Le lien est stable ; le message est libre.
Le partageur porte la relation ; Komerce porte la transaction.
```

Le lien reçu ouvre la Boutique dans le contexte de la liste. La liste et le panier personnel restent deux surfaces distinctes d'une même Boutique.

Le participant peut :

- consulter les lignes snapshot ;
- sélectionner les articles encore disponibles ;
- ouvrir la fiche produit canonique ;
- acheter sa sélection via le checkout canonique ;
- sauvegarder explicitement la liste dans « Mes listes ».

Le propriétaire peut également :

- modifier la quantité d'une ligne disponible ;
- retirer une ligne après confirmation ;
- repartager le lien ;
- fermer la liste.

L'ajout d'un nouvel article à une liste existante n'est pas exposé dans l'interface actuelle. La capacité backend correspondante reste disponible pour un futur parcours produit dédié.

Toute documentation parlant de `panier collectif`, `workspace`, `event`, `settlement`, `engagement`, `contribution`, `ready_to_pay` ou `needs_validation` est historique si elle contredit le code actuel et la doctrine V2.

---

## 2. Où vit le code Boutique ?

```txt
public/boutique/
├── index.html
├── js/
├── css/
├── css/dist/
├── scripts/
├── tests/
└── docs/              # historique ou généré, non canonique par défaut
```

Règles :

- modifier les sources `js/**` et `css/**` ;
- ne jamais éditer `css/dist/**` à la main ;
- rebuilder les CSS avec la commande canonique si une source change ;
- régénérer les graphes si la cartographie change ;
- ne jamais créer un second owner pour une surface existante.

---

## 3. Carte rapide des fichiers

| Besoin | Owner principal |
|---|---|
| Entrée page, liens CSS/JS, cache-buster | `public/boutique/index.html` |
| Données catégories / sous-catégories | `public/boutique/js/shop-schema.js` |
| Orchestration catalogue | `public/boutique/js/b-catalog.js` |
| Carte produit | `public/boutique/js/render/render-product-card.js` |
| Modal produit | `public/boutique/js/b-modal-core.js` et modules `b-modal-*` |
| Panier personnel | `public/boutique/js/b-cart.js` et modules cart dédiés |
| Checkout canonique | `public/boutique/js/b-checkout.js` et `b-checkout-render.js` |
| Création et partage natif d'une liste | `public/boutique/js/b-share-cart.js` |
| Bandeau d'entrée par lien | `public/boutique/js/b-group-banner.js` |
| Vue liste, bibliothèque et actions propriétaire | `public/boutique/js/group/group-side-cart.js` |
| Adapter liste → checkout | `public/boutique/js/group/group-checkout-adapter.js` |
| Variation de prix snapshot / catalogue | `public/boutique/js/group/group-price-variation.js` |
| API frontend liste partageable | `public/boutique/js/group/group-api.js` |
| État/badge partagé encore actif | `public/boutique/js/group/group-state.js` |
| CSS side-cart liste | `public/boutique/css/shared-list-side-cart.css` |
| CSS partage | `public/boutique/css/share-cart.css` |
| CSS panier / checkout | `public/boutique/css/cart.css` et sources checkout associées |
| Bundler CSS | `public/boutique/scripts/deploy-css.js` |
| Garde-fous Boutique | `public/boutique/scripts/check-*.js`, `audit-*.js` |

Les fichiers suivants ne sont plus des owners actifs et ne doivent pas être réintroduits :

```txt
public/boutique/js/b-group-view.js
public/boutique/js/group/group-render-creator.js
public/boutique/js/group/group-helpers.js
public/boutique/css/group-cart-flow.css
```

---

## 4. Parcours liste partageable

### Entrée destinataire

```txt
?p=TOKEN
→ b-group-banner.js
→ group-side-cart.js
→ GET /api/shared-carts/public/:token
```

L'ouverture d'un lien ne sauvegarde jamais automatiquement la liste.

### Consultation produit

```txt
clic image ou nom
→ fermeture drawer mobile
→ modal produit canonique
→ fermeture modal
→ réouverture de la liste mobile
```

L'action « Ajouter au panier » de la modal modifie uniquement le panier personnel.

### Achat de la sélection

```txt
sélection locale
→ group-checkout-adapter.js
→ checkout canonique
→ POST /api/orders
```

Invariants :

- `product_id` est l'identifiant catalogue réel ;
- `shared_cart_item_id` reste distinct ;
- le checkout utilise le prix catalogue actuel ;
- le snapshot reste la mémoire de la liste ;
- toute variation de prix est signalée ;
- une ligne déjà achetée ne peut être réclamée deux fois.

### Bibliothèque

```txt
Mon Komerce → Mes listes
→ Créées par moi
→ Partagées avec moi
```

Une liste reçue n'apparaît dans « Partagées avec moi » qu'après une action explicite de sauvegarde.

---

## 5. Interdits

Ne pas :

- recréer un onglet principal Groupe ;
- appeler `switchView('group')` ;
- réintroduire une édition groupée du panier partagé ;
- utiliser le PUT historique pour une modification unitaire de quantité ;
- modifier une liste depuis la modal produit ;
- fusionner panier personnel et sélection de liste ;
- facturer le prix snapshot ;
- sauvegarder implicitement un lien reçu ;
- créer un checkout spécifique à la liste ;
- réintroduire les notions de contribution, cagnotte ou financement collectif.

---

## 6. Comment modifier sans casser

### Changement JavaScript

1. Identifier l'owner dans la carte ci-dessus.
2. Lire son header `@komerce-arch`.
3. Modifier l'owner et ses helpers directs uniquement.
4. Mettre à jour les tests ciblés.
5. Régénérer la cartographie si le contrat change.

Commandes usuelles :

```bash
cd public/boutique
npm run check:imports
npm run check:html
npm run check:body-classes
npm run audit:arch
```

### Changement CSS

1. Modifier la source CSS owner.
2. Rebuilder avec la commande canonique.
3. Commiter les sources et les artefacts générés attendus.
4. Vérifier le cache-buster.

```bash
cd public/boutique
npm run deploy:css
npm run check:cache
npm run audit:arch
```

---

## 7. Validation du domaine liste partageable

Tests ciblés à inclure selon le changement :

```txt
group-side-cart
group-checkout-adapter
group-price-variation
group-api
b-checkout
b-modal
shared-cart-reads
shared-cart-items-service
shared-cart-library
orders create
```

Audits :

```bash
node scripts/audit-backend-arch.js
node public/boutique/scripts/audit-boutique-arch.js
node public/boutique/scripts/check-inline-scripts.js
node public/boutique/scripts/feature-registry-check.js --strict
node scripts/gen-boutique-360.js --check
```

Ne jamais annoncer un lot certifié si un test critique, une intégration PostgreSQL ou un E2E obligatoire n'a pas réellement été exécuté avec succès.

---

## 8. Definition of Done Boutique

Une modification Boutique est finie si :

- le bon owner a été modifié ;
- aucun owner mort n'est cité comme actif ;
- les headers et manifests sont cohérents avec le code ;
- les fichiers générés sont à jour ;
- les tests ciblés passent ;
- les audits applicables passent ;
- aucun bouton mort, statut technique ou surprise transactionnelle n'est introduit.
