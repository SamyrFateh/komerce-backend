# Boutique — Component Ownership

> Mis à jour : **2026-08-05**  
> Statut : document actif pour savoir **où toucher le code Boutique**.

---

## 1. Règle fondamentale

```txt
Un composant = une vérité.
Pas de doublon HTML.
Pas de logique parallèle.
Pas de CSS qui compense une erreur JS.
Pas de JS qui recrée ce qu'un renderer sait déjà faire.
```

Le point d'entrée pratique reste `docs/boutique/README.md`.

---

## 2. Doctrine produit active

La Boutique suit **Boutique First**.

Pour la liste partageable :

```txt
La liste porte la sélection ; le message porte la cause.
Le lien est stable ; le message est libre.
Le partageur porte la relation ; Komerce porte la transaction.
```

Le panier personnel et la liste partageable restent deux surfaces distinctes. Le checkout canonique porte la transaction. La liste n'est ni une cagnotte, ni un checkout collectif, ni une page autonome parallèle à la Boutique.

---

## 3. Table de propriété

| Zone / composant | Fichier propriétaire | Possède | Ne doit pas posséder |
|---|---|---|---|
| Schéma boutique | `public/boutique/js/shop-schema.js` | catégories, sous-catégories, images, ordre, normalisation | DOM, listeners, layout |
| Catalogue | `public/boutique/js/b-catalog.js` | chargement, filtrage, pagination, ouverture modal via contrat | schéma catégories, internals modal |
| Carte produit | `public/boutique/js/render/render-product-card.js` | HTML d'une carte produit | mutation panier/liste, orchestration modal |
| Panier personnel | `public/boutique/js/b-cart.js` et modules cart dédiés | état et actions du panier personnel | état ou mutation de liste partageable |
| Checkout canonique | `public/boutique/js/b-checkout.js` + `b-checkout-render.js` | confirmation de commande, paiement, soumission | édition d'une liste partageable |
| Modal produit | `public/boutique/js/b-modal-core.js` et modules `b-modal-*` | consultation produit et actions panier personnel | mutation de liste partageable |
| Création / partage d'une liste | `public/boutique/js/b-share-cart.js` | création depuis la sélection initiale, lien stable, partage natif | rendu complet de la liste, checkout |
| Entrée par lien | `public/boutique/js/b-group-banner.js` | détection du token et activation du contexte | rendu détaillé, mutation métier |
| Vue liste et bibliothèque | `public/boutique/js/group/group-side-cart.js` | rendu participant/créateur, sélection locale, bibliothèque, actions propriétaire, retour modal | panier personnel, calcul transactionnel |
| Adapter liste → checkout | `public/boutique/js/group/group-checkout-adapter.js` | projection de la sélection vers `CheckoutSelection` et contexte relationnel temporaire | mutation du panier personnel, calcul serveur du prix, mutation de liste |
| Variation de prix | `public/boutique/js/group/group-price-variation.js` | comparaison snapshot/prix actuel et présentation | calcul transactionnel serveur |
| API liste frontend | `public/boutique/js/group/group-api.js` | transport HTTP liste/bibliothèque/actions unitaires | rendu UI, logique métier |
| État partagé résiduel actif | `public/boutique/js/group/group-state.js` | badge et petits helpers encore consommés | ancien switcher d'onglet Groupe |
| CSS liste side-cart | `public/boutique/css/shared-list-side-cart.css` | rendu mobile/desktop de la liste et bibliothèque | panier personnel, modal produit |
| CSS partage | `public/boutique/css/share-cart.css` | création et partage natif | rendu complet de la liste |
| CSS panier / checkout | `public/boutique/css/cart.css` et sources checkout associées | panier personnel, checkout, side-cart générique | règles métier de liste |

Les fichiers suivants ne sont plus des owners actifs :

```txt
public/boutique/js/b-group-view.js
public/boutique/js/group/group-render-creator.js
public/boutique/js/group/group-helpers.js
public/boutique/css/group-cart-flow.css
```

Ils ne doivent pas être cités dans un nouveau header, manifest ou document actif.

---

## 4. Contrat de la liste partageable

### Entrée et rendu

```txt
?p=TOKEN
→ b-group-banner.js
→ group-side-cart.js
→ GET /api/shared-carts/public/:token
```

Le lien reçu ne crée aucune sauvegarde implicite.

### Consultation produit

```txt
ligne snapshot
→ modal produit canonique
→ éventuel ajout au panier personnel
→ retour à la liste
```

La modal ne possède aucune action de mutation de liste.

### Achat

```txt
sélection locale
→ group-checkout-adapter.js
→ checkout canonique
→ POST /api/orders
```

Invariants :

- `product_id` désigne le produit catalogue réel ;
- `shared_cart_item_id` désigne la ligne de liste ;
- les deux identifiants restent distincts ;
- le backend recalcule le prix depuis le catalogue ;
- le snapshot reste visible dans la liste ;
- toute variation de prix est expliquée au checkout ;
- une ligne ne peut être achetée qu'une seule fois.

### Propriétaire

Le propriétaire peut :

- modifier une quantité avec le PATCH unitaire ;
- retirer une ligne après confirmation ;
- repartager le lien ;
- fermer la liste.

L'interface actuelle n'expose pas l'ajout d'un nouvel article à une liste existante. La route backend correspondante peut rester disponible pour un futur parcours conçu explicitement.

---

## 5. Interdits

```txt
Ne pas recréer data-tab="group".
Ne pas appeler switchView('group').
Ne pas fusionner state.cart et sharedListSelection.
Ne pas réintroduire l'édition groupée historique.
Ne pas modifier une liste depuis la modal produit.
Ne pas facturer le prix snapshot.
Ne pas sauvegarder automatiquement un lien reçu.
Ne pas créer un checkout spécifique à la liste.
Ne pas réintroduire contribution, cagnotte ou financement collectif.
```

---

## 6. Validation

Commandes Boutique usuelles :

```bash
cd public/boutique
npm run check:imports
npm run check:html
npm run check:body-classes
npm run audit:arch
```

Audits globaux :

```bash
node scripts/audit-backend-arch.js
node public/boutique/scripts/audit-boutique-arch.js
node public/boutique/scripts/check-inline-scripts.js
node public/boutique/scripts/feature-registry-check.js --strict
node scripts/gen-boutique-360.js --check
```

Tests ciblés selon la zone :

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

---

## 7. Gate global B4 — couverture applicative

La propriété Feature-First de la Boutique est désormais vérifiée sur **tout le code applicatif** par :

```bash
npm run gate:boutique-ownership:full
```

Invariant B4 :

- chaque fichier applicatif `public/boutique/**/*.{js,mjs,cjs,ts,css,html}` doit être rattaché à une carte `features/*.feature.js` ;
- le gate s'exécute en `--strict` et la cible est **0 fichier applicatif orphelin** ;
- `public/boutique/harnais/**` est explicitement hors périmètre : ce sont des outils/repros de mesure navigateur, pas des owners runtime ;
- tests, artefacts générés, docs et scripts infra restent exclus par le même contrat ;
- toute nouvelle source runtime Boutique sans feature owner fait échouer la CI.

État de fermeture B4-0 : **131 / 131 fichiers applicatifs rattachés — 100%**.

---

## 8. Règle de clôture

Une modification est acceptable si :

- le bon owner a été modifié ;
- aucun owner parallèle n'est créé ;
- aucun fichier supprimé n'est encore présenté comme actif ;
- les headers et manifests concordent avec le code ;
- les tests automatiques applicables passent ;
- les artefacts générés sont régénérés par les commandes canoniques ;
- aucune régression panier, liste, modal ou checkout n'est introduite.
