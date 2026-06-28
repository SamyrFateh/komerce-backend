# Boutique — Architecture modal produit

> Mis à jour : **2026-06-28**  
> Statut : document actif pour modifier la modal produit Boutique.

---

## 1. Rôle

La modal produit sert à consulter un produit du catalogue vivant depuis la boutique.

Elle est distincte de la fiche article lecture seule du panier partagé, qui est construite depuis le snapshot dans `b-group-view.js`.

Règle Boutique First :

```txt
Catalogue vivant → modal produit globale.
Panier partagé participant → fiche snapshot lecture seule.
```

Ne pas mélanger ces deux vérités.

---

## 2. Owners actifs

### JS

| Zone | Owner |
|---|---|
| Façade publique / compatibilité ouverture | `public/boutique/js/b-modal.js` |
| Cycle ouverture/fermeture, orchestration, body lock, topbar, recherche interne | `public/boutique/js/b-modal-core.js` |
| Rendu contenu produit, prix, variantes, livraison/trust mobile, actions produit | `public/boutique/js/b-modal-product.js` |
| Images, carousel, compteur, lightbox fullscreen, bouton **Voir en grand** | `public/boutique/js/b-modal-image-ux.js` |
| Social proof conditionnel | `public/boutique/js/b-modal-social-proof.js` |
| Navigation produit précédent/suivant | `public/boutique/js/b-modal-nav.js` |
| Suggestions / recommandations dans la modal | `public/boutique/js/b-modal-suggestions.js` |
| Intégration panier personnel depuis la modal | `public/boutique/js/b-modal-cart.js` |
| Enrichissements desktop dédiés | `public/boutique/js/b-modal-desktop-enhancers.js` |
| View model modal | `public/boutique/js/view-models/modal-view-model.js` |

### CSS

| Zone | Owner |
|---|---|
| Shell / overlay / topbar / scroll / actions | `public/boutique/css/modal-shell.css` |
| Images / carousel / media / bouton **Voir en grand** | `public/boutique/css/modal-media.css` |
| Informations produit / prix / actions | `public/boutique/css/modal-product.css` |
| Extension PDP hybride desktop | `public/boutique/css/modal-product-lot4-hybrid.css` |

Ancienne doc ou ancien fichier `modal.css` monolithique : historique. Ne pas l'utiliser comme source de vérité si le code actuel est split en `modal-*`.

---

## 3. Cas sensible : Voir en grand mobile

Owner fonctionnel : `public/boutique/js/b-modal-image-ux.js`.

Owner CSS : `public/boutique/css/modal-media.css`.

Orchestrateur : `public/boutique/js/b-modal-core.js`.

Invariants :

- le bouton **Voir en grand** est injecté dans la zone media de la modal produit ;
- le fullscreen image appartient à `b-modal-image-ux.js`, pas au catalogue ;
- le layout et la position du bouton appartiennent à `modal-media.css` ;
- ne pas corriger ce parcours depuis `public/boutique/js/b-catalog.js`, `public/boutique/css/products.css` ou `public/boutique/css/boutique-desktop.css`.

---

## 4. Règles de modification

### JS

Modifier le fichier owner de la zone touchée :

- ouverture/fermeture globale → `public/boutique/js/b-modal-core.js` ;
- rendu produit catalogue → `public/boutique/js/b-modal-product.js` ;
- image, carousel, lightbox, **Voir en grand** → `public/boutique/js/b-modal-image-ux.js` ;
- suggestions → `public/boutique/js/b-modal-suggestions.js` ;
- panier depuis modal → `public/boutique/js/b-modal-cart.js`.

La modal produit ne doit pas posséder :

- le pager catégories ;
- le hero ;
- le panier partagé participant ;
- la fiche snapshot lecture seule.

### CSS

Modifier le fichier CSS owner :

- structure overlay/topbar/actions → `public/boutique/css/modal-shell.css` ;
- image/carousel/media/**Voir en grand** → `public/boutique/css/modal-media.css` ;
- infos produit/prix/actions → `public/boutique/css/modal-product.css` ;
- enrichissement hybride desktop → `public/boutique/css/modal-product-lot4-hybrid.css`.

Après modification CSS :

```bash
cd public/boutique
npm run deploy:css
npm run check:cache
npm run audit:arch
```

---

## 5. Invariants

- Mobile : ne pas casser le scroll ni les actions visibles.
- Desktop : ne pas corriger un problème de layout global depuis la modal.
- Panier partagé : ne pas réutiliser la modal catalogue pour afficher un article snapshot si cela peut montrer un prix différent.
- Pas de CSS stable injecté par JS.
- Pas de sélecteurs `.k-modal-*` dispersés hors fichiers modal owners sans raison documentée.
- Toute modification du parcours **Voir en grand** doit passer par `b-modal-image-ux.js` et `modal-media.css`.

---

## 6. Tests

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

Tests manuels :

1. ouvrir une fiche produit depuis la grille mobile ;
2. vérifier que le bouton **Voir en grand** est visible et non chevauché ;
3. ouvrir le fullscreen image puis le fermer ;
4. ouvrir une fiche produit depuis la grille desktop ;
5. ajouter au panier depuis la modal ;
6. fermer et retrouver le scroll correct ;
7. vérifier que la fiche lecture seule du panier partagé n'a pas été changée par erreur.
