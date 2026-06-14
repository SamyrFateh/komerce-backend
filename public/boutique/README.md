# Frontend Boutique Komerce

> Point d'entrée local pour toucher `public/boutique/**`.  
> Mis à jour : **2026-06-14**.

---

## 1. Lire d'abord

Depuis le repo complet, lire :

```txt
../../docs/boutique/README.md
```

Ce fichier local donne les commandes et rappels rapides. Le guide actif complet est `docs/boutique/README.md`.

Ne pas démarrer depuis `public/boutique/docs/**` : ces documents sont historiques ou générés, sauf mention contraire explicite dans `docs/boutique/README.md`.

---

## 2. Doctrine active

La Boutique suit **Boutique First**.

```txt
Le lien partagé ouvre la boutique.
Le participant consulte en lecture seule.
Il règle sa part seulement si le panier est payable.
```

Lire si le changement touche le panier partagé :

```txt
../../docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md
../../docs/implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md
```

Toute ancienne documentation `panier collectif`, `workspace`, `event`, `V4.1`, `engagement`, `settlement` ou `contribution` est historique si elle n'est pas reprise dans ces deux documents.

---

## 3. Structure active

```txt
public/boutique/
├── README.md
├── package.json
├── index.html
├── js/
├── css/                  # sources CSS à éditer
├── css/dist/             # bundles générés, ne jamais éditer à la main
├── scripts/              # garde-fous et bundler CSS
├── tests/
└── docs/                 # historique/généré, non canonique par défaut
```

---

## 4. Chercher vite

| Besoin | Fichier principal |
|---|---|
| Catégories / sous-catégories | `js/shop-schema.js` |
| Rail catégories | `js/render/render-categories.js` + `js/controllers/home-controller.js` |
| Catalogue / filtrage produits | `js/b-catalog.js` |
| Carte produit | `js/render/render-product-card.js` |
| Modal produit | `js/b-modal.js` |
| Panier personnel | `js/b-cart.js` |
| Partage du panier | `js/b-share-cart.js` |
| Vue panier partagé participant/créateur | `js/b-group-view.js` |
| API panier partagé frontend | `js/group/group-api.js` |
| Statuts / helpers panier partagé | `js/group/group-helpers.js` |
| Rendu créateur panier partagé | `js/group/group-render-creator.js` |
| CSS panier / checkout / side-cart | `css/cart.css` |
| CSS panier partagé | `css/group-cart-flow.css` |
| CSS catégories | `css/categories.css` |
| CSS produits | `css/products.css` |
| CSS desktop | `css/boutique-desktop.css` |
| Pipeline CSS | `scripts/deploy-css.js` |

Pour le détail des owners, lire `../../docs/boutique/BOUTIQUE_COMPONENT_OWNERSHIP.md`.

---

## 5. Commandes

Toutes les commandes se lancent depuis `public/boutique`.

```bash
# CSS
npm run deploy:css
npm run check:cache

# JS / HTML / structure
npm run check:html
npm run check:imports
npm run check:body-classes
npm run check:breakpoints
npm run audit:arch
npm run audit:ownership

# Garde-fou wording panier partagé Boutique First
npm run check:group-wording

# Validation complète
npm run check:all
```

---

## 6. Modifier du CSS

1. Modifier uniquement la source owner dans `css/*.css`.
2. Ne jamais modifier `css/dist/*.css` à la main.
3. Rebuilder :

```bash
npm run deploy:css
npm run check:cache
npm run audit:arch
```

4. Commiter les sources modifiées + bundles dist + `index.html` si cache-buster changé + `.cache-buster-state.json`.

---

## 7. Modifier le panier partagé Boutique First

Checklist avant commit :

- Le lien reste `/boutique/?p=TOKEN`.
- Le participant reste en lecture seule.
- Le bouton argent dit `Régler ma part`.
- Le paiement n'apparaît que si le panier est payable.
- La fiche produit participant vient du snapshot, pas du catalogue live.
- Aucun statut technique n'est visible.
- Le retour paiement revient dans la boutique.

Tests manuels minimum :

1. `ready_to_pay` → bouton `Régler ma part` visible.
2. `needs_validation` → articles visibles, pas de paiement, message clair.
3. Fiche article lecture seule → aucun bouton ajouter/modifier/supprimer.
4. Paiement success/cancel → retour boutique.
5. Montant supérieur au reste → maximum annoncé et borné.

---

## 8. En cas de doute

| Situation | Action |
|---|---|
| Tu ne sais pas quel fichier toucher | Lire `../../docs/boutique/README.md` |
| Tu touches du CSS | Lire `../../docs/boutique/BOUTIQUE_CSS_PIPELINE.md` |
| Tu touches un composant JS/CSS | Lire `../../docs/boutique/BOUTIQUE_COMPONENT_OWNERSHIP.md` |
| Tu touches la modal | Lire `../../docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md` |
| Un ancien doc contredit Boutique First | Boutique First gagne |
| Un test automatique échoue | Corriger avant commit ou documenter explicitement la dette dans `../../docs/chantier/STATUS.md` |
