# Boutique — Architecture modal produit

> Mis à jour : **2026-06-14**  
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

| Zone | Owner |
|---|---|
| Cycle ouverture/fermeture, rendu principal | `public/boutique/js/b-modal.js` |
| Enrichissements desktop si présents | modules JS dédiés documentés autour de `b-modal*` |
| Shell / overlay / topbar | `public/boutique/css/modal-shell.css` |
| Images / carousel / media | `public/boutique/css/modal-media.css` |
| Informations produit / prix / actions | `public/boutique/css/modal-product.css` |
| Extension PDP hybride desktop | `public/boutique/css/modal-product-lot4-hybrid.css` |

Ancienne doc ou ancien fichier `modal.css` monolithique : historique. Ne pas l'utiliser comme source de vérité si le code actuel est split en `modal-*`.

---

## 3. Règles de modification

### JS

`b-modal.js` possède :

- ouverture/fermeture ;
- rendu détail produit catalogue ;
- actions produit normales ;
- intégration avec panier personnel.

Il ne doit pas posséder :

- le pager catégories ;
- le hero ;
- le panier partagé participant ;
- la fiche snapshot lecture seule.

### CSS

Modifier le fichier CSS owner :

- structure overlay/topbar → `modal-shell.css` ;
- image/carousel/media → `modal-media.css` ;
- infos produit/prix/actions → `modal-product.css` ;
- enrichissement hybride desktop → `modal-product-lot4-hybrid.css`.

Après modification CSS :

```bash
cd public/boutique
npm run deploy:css
npm run check:cache
npm run audit:arch
```

---

## 4. Invariants

- Mobile : ne pas casser le scroll ni les actions visibles.
- Desktop : ne pas corriger un problème de layout global depuis la modal.
- Panier partagé : ne pas réutiliser la modal catalogue pour afficher un article snapshot si cela peut montrer un prix différent.
- Pas de CSS stable injecté par JS.
- Pas de sélecteurs `.k-modal-*` dispersés hors fichiers modal owners sans raison documentée.

---

## 5. Tests

Après modification modal :

```bash
cd public/boutique
npm run check:html
npm run check:imports
npm run check:body-classes
npm run audit:arch
```

Tests manuels :

1. ouvrir une fiche produit depuis la grille mobile ;
2. ouvrir une fiche produit depuis la grille desktop ;
3. ajouter au panier depuis la modal ;
4. fermer et retrouver le scroll correct ;
5. vérifier que la fiche lecture seule du panier partagé n'a pas été changée par erreur.
