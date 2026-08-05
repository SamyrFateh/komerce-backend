# Boutique Komerce — Guide opératoire

> Mis à jour : **2026-06-16**  
> Statut : **point d'entrée actif pour toute modification Boutique**.

Ce document répond aux quatre questions pratiques :

```txt
Quoi chercher ?
Où modifier ?
Comment toucher le code ?
Comment valider ?
```

---

## 0. Doctrine graphe obligatoire

Toute modification Boutique doit respecter :

```txt
docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md
```

Avant de toucher `public/boutique/**`, lire aussi :

```txt
docs/KOMERCE_ARCH_CARTOGRAPHY_STATUS.md
docs/KOMERCE_ARCH_HEADER_GRAPH.md
docs/komerce-arch-header-graph.json
```

Règle : aucun nouveau fichier Boutique ne doit être muet. Il doit avoir un header `@komerce-arch` ou être agrégé par `@komerce-arch-lite` avec `@owner`.

---

## 1. Vérité produit active

La Boutique suit la doctrine **Boutique First**.

Lire si le changement touche le panier partagé :

- `docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md`
- `docs/implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md`

Règle courte :

```txt
Le lien partagé ouvre la boutique.
Le participant consulte en lecture seule.
Il règle sa part seulement si le panier est payable.
```

Toute ancienne documentation `panier collectif`, `workspace`, `event`, `V4.1`, `engagement`, `settlement` ou `contribution` est historique sauf si elle est explicitement reprise dans ces deux documents.

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
└── docs/              # local historique/généré, non canonique par défaut
```

Règle :

- modifier les sources `js/**` et `css/**` ;
- ne jamais éditer `css/dist/**` à la main ;
- rebuild CSS avec `npm run deploy:css` si une source CSS change ;
- mettre à jour les headers architecture et le graphe si le contrat fonctionnel change.

---

## 3. Chercher vite : carte des fichiers

| Besoin | Chercher / modifier ici |
|---|---|
| Entrée page, liens CSS/JS, cache-buster | `public/boutique/index.html` |
| Données catégories / sous-catégories | `public/boutique/js/shop-schema.js` |
| Rendu rail catégories | `public/boutique/js/render/render-categories.js` |
| Orchestration accueil, clics catégories | `public/boutique/js/controllers/home-controller.js` |
| Chargement catalogue, filtrage produits | `public/boutique/js/b-catalog.js` |
| Carte produit | `public/boutique/js/render/render-product-card.js` |
| Modal produit | `public/boutique/js/b-modal.js` |
| Panier personnel | `public/boutique/js/b-cart.js` et modules cart dédiés |
| Création / partage du panier partagé | `public/boutique/js/b-share-cart.js` |
| Vue participant / créateur du panier partagé | `public/boutique/js/b-group-view.js` |
| API frontend panier partagé | `public/boutique/js/group/group-api.js` |
| Rendu créateur panier partagé | `public/boutique/js/group/group-render-creator.js` |
| CSS panier / checkout / side-cart | `public/boutique/css/cart.css` |
| CSS flux groupe / panier partagé | `public/boutique/css/group-cart-flow.css` |
| CSS catégories | `public/boutique/css/categories.css` |
| CSS cartes produits | `public/boutique/css/products.css` |
| CSS modal produit | `public/boutique/css/modal-*.css` |
| CSS desktop premium | `public/boutique/css/boutique-desktop.css` |
| Bundler CSS | `public/boutique/scripts/deploy-css.js` |
| Garde-fous Boutique | `public/boutique/scripts/check-*.js`, `audit-*.js` |

---

## 4. Documents Boutique actifs

| Besoin | Lire |
|---|---|
| Doctrine graphe obligatoire | `docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md` |
| Point d'entrée local + commandes | `public/boutique/README.md` |
| Pipeline CSS | `docs/boutique/BOUTIQUE_CSS_PIPELINE.md` |
| Ownership composants JS/CSS | `docs/boutique/BOUTIQUE_COMPONENT_OWNERSHIP.md` |
| Modal produit | `docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md` |

Les docs sous `public/boutique/docs/**` sont historiques ou générées. Elles ne font pas foi si elles contredisent les documents ci-dessus ou le code.

---

## 5. Comment modifier sans casser

### Cas A — Changement JS simple

1. Identifier le fichier owner dans la carte ci-dessus.
2. Lire son header et son `interventionIndex` dans le graphe.
3. Modifier uniquement ce fichier et ses helpers directs.
4. Mettre à jour le header si le contrat change.
5. Lancer :

```bash
cd public/boutique
npm run check:imports
npm run check:html
npm run check:body-classes
npm run audit:arch
```

6. Depuis la racine, régénérer le graphe si la cartographie change :

```bash
node scripts/generate-komerce-arch-graph.js
```

### Cas B — Changement CSS

1. Modifier le fichier source owner dans `css/*.css`.
2. Rebuilder :

```bash
cd public/boutique
npm run deploy:css
npm run check:cache
npm run audit:arch
```

3. Commiter les sources CSS, les bundles `css/dist/**`, `index.html` si le cache-buster change, et `.cache-buster-state.json`.
4. Si un nouveau fichier CSS source apparaît ou change d'owner, mettre à jour la cartographie.

### Cas C — Panier partagé Boutique First

Lire d'abord :

- `docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md`
- `docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md`
- `docs/implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md`

Puis vérifier selon la zone :

| Sujet | Fichiers clés |
|---|---|
| Bouton partager / choix ready_to_pay | `b-share-cart.js` |
| Lien participant `?p=TOKEN` | `b-group-view.js` |
| Libellés humains | `b-group-view.js`, `group-render-creator.js` |
| Bouton `Régler ma part` | `b-group-view.js` |
| Fiche lecture seule snapshot | `b-group-view.js` |
| Appels API | `group-api.js` |

Interdits :

- ne pas envoyer le participant directement au checkout ;
- ne pas appeler le catalogue live pour la fiche lecture seule ;
- ne pas modifier le panier partagé depuis la vue participant ;
- ne pas afficher `open`, `closed`, `awaiting_choice`, `settlement`, `contribution`, `engagement` comme langage humain.

---

## 6. Tests de validation

### Garde-fous automatiques

Depuis `public/boutique` :

```bash
npm run check:group-wording
npm run check:html
npm run check:imports
npm run check:body-classes
npm run check:cache
npm run check:breakpoints
npm run audit:arch
npm run audit:ownership
```

Pour une validation complète :

```bash
npm run check:all
```

### Tests manuels Boutique First

1. **Prêt à payer** : le lien `/boutique/?p=TOKEN` affiche le panier et le bouton `Régler ma part`.
2. **À valider ensemble** : le lien affiche les articles mais pas de bouton paiement ; message `Paiement pas encore ouvert`.
3. **Lecture seule** : clic article ouvre une fiche snapshot sans ajouter/modifier/supprimer.
4. **Retour paiement** : succès/annulation reviennent dans la boutique, pas sur une page morte.
5. **Montant** : le maximum affiché est le reste dû ; une saisie trop haute est bornée ou expliquée avant l'appel API.
6. **Statuts** : seuls les états humains sont visibles.

---

## 7. Definition of Done Boutique

Une modification Boutique est finie si :

- le bon owner a été modifié ;
- le header architecture du fichier touché a été lu et mis à jour si nécessaire ;
- le graphe a été régénéré si la cartographie change ;
- aucun ancien doc n'a été utilisé comme vérité active ;
- les garde-fous applicables passent ;
- les tests manuels du parcours touché sont faits ;
- aucun bouton mort, statut technique, page morte ou surprise de paiement n'est introduit.