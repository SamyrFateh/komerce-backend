# Komerce Boutique — Architecture

> **Document normatif.** Il décrit les règles qui doivent rester vraies.
> La photographie du code réel est générée dans `BOUTIQUE_ARCHITECTURE_LIVE.md` par `npm run boutique:arch`.
> La composition CSS canonique est définie uniquement dans `scripts/css-bundles.js`.
> Les gardes exécutables priment toujours sur un chiffre copié dans la documentation.

---

## 1. Sources de vérité

| Sujet | Source canonique |
|---|---|
| Composition des bundles CSS | `scripts/css-bundles.js` |
| Bundles livrés | `css/dist/base.css`, `components.css`, `desktop.css` |
| Snapshot architecture | `docs/BOUTIQUE_ARCHITECTURE_LIVE.md` |
| Audit architecture | `scripts/audit-boutique-arch.js` / `npm run boutique:audit` |
| Conflits de cascade | `scripts/css-guard.js` + `.css-guard-baseline.json` |
| Overrides de spécificité | `scripts/css-specificity-guard.js` + `.css-specificity-guard-baseline.json` |
| Dette `!important` ouverte | `scripts/check-important.js` + `.important-baseline.json` |
| Cache-busters CSS | `scripts/deploy-css.js` + `index.html` |
| Ownership applicatif global | `scripts/boutique-ownership-full-check.js` / `npm run gate:boutique-ownership:full` |

**Interdit** : reconstruire l’architecture en parsant un ancien wrapper comme `bundle-css.js`, ou maintenir manuellement une seconde liste de fichiers censée remplacer `css-bundles.js`.

---

## 2. Invariants exécutables

### I-1 — Aucun CSS orphelin, aucune source bundle manquante

Tout `css/*.css` doit être déclaré dans `BUNDLES`, et toute entrée `BUNDLES` doit exister sur disque.
Le LIVE doit rester à :

- CSS orphelins = **0** ;
- sources bundle manquantes = **0**.

### I-2 — Dette de cascade = zéro

`css-guard` est un cliquet à **0**. Une nouvelle paire sélecteur / contexte media / propriété avec deux valeurs concurrentes est une régression, même si le rendu semble correct par ordre de chargement.

Une correction doit supprimer ou re-héberger la déclaration perdante ; on ne remonte jamais la baseline pour accepter une nouvelle collision.

### I-3 — Dette de spécificité = zéro

`css-specificity-guard` est un cliquet à **0**. Une classe globale (`k-home-premium-v1`, `modal-open`, etc.) ne doit pas devenir un mécanisme caché pour écraser le selector canonique.

Pattern accepté pour un état qui doit rester sans bonus de spécificité :

```css
body:where(.modal-open) {
  position: fixed;
}
```

Les classes premium peuvent rester des marqueurs d’état JS, mais les valeurs visuelles durables doivent vivre chez l’owner canonique et non dans une couche de sur-spécificité.

### I-4 — Dette `!important` ouverte = zéro

La métrique de dette est **open-debt-only**. Les trois occurrences physiques restantes sont un seul guard revu et verrouillé structurellement :

- fichier : `boutique-desktop.css` ;
- breakpoint : `@media (min-width: 900px)` ;
- selectors : `.k-cart-drawer.open, .k-cart-overlay.open` ;
- déclarations : `display:none`, `transform:translateX(100%)`, `pointer-events:none` ;
- registre : `desktop-mobile-drawer-neutralization`.

Ce guard neutralise le drawer/overlay mobile lorsque `.open` subsiste côté JS sur desktop. Tout changement de selector, valeur ou media le fait automatiquement redevenir dette ouverte.

### I-5 — Pas de token CSS cassé

Le pattern résiduel `var(--token)xxx` est interdit. Cible LIVE : **0**.

### I-6 — Couleurs centralisées

Les couleurs métier passent par `tokens.css`. Les hex hors tokens ne sont admis que comme exceptions explicitement justifiées par l’audit, notamment les couleurs de marque PayPal et les fallbacks de token documentés.

Le LIVE sert à rendre leur nombre visible ; on n’ajoute jamais un hex simplement pour faire taire un conflit de cascade.

### I-7 — Pas de CSS structurel injecté par JavaScript

Le JS pose des classes d’état et des variables CSS runtime ; il n’injecte pas de `<style>` structurel pour contourner l’ownership CSS.

### I-8 — Desktop explicite

Le breakpoint desktop canonique est `900px`. Les exceptions de breakpoint existantes sont régies par le guard dédié ; aucune nouvelle valeur n’est ajoutée sans justification et sans mise à jour du contrat concerné.

### I-9 — Ownership applicatif global strict

`gate:boutique-ownership:full` scanne toutes les sources applicatives Boutique et doit rester à **0 orphelin**. Un nouveau fichier runtime doit être déclaré dans une carte Feature-First au moment où il entre dans le produit.

Les répertoires explicitement non applicatifs (`tests`, `scripts`, `docs`, `harnais`, artefacts générés) ne sont pas des owners runtime et restent hors de ce compteur.

---

## 3. Topologie CSS actuelle

Ordre livré dans `index.html` :

1. `base.css`
2. `components.css`
3. `desktop.css`

La liste exacte des sources de chaque bundle est **uniquement** `scripts/css-bundles.js`. Au 29/08/2026, le LIVE observe **39 sources CSS**, toutes déclarées et présentes.

Rôle des couches :

- **base** : tokens, reset, layout, hero et convergences shell/mobile de fondation ;
- **components** : catégories, produits, modale/PDP, panier/checkout, identité, paiements, listes partagées et convergences fonctionnelles ;
- **desktop** : adaptations desktop explicites, polish side-cart et navigation catégories desktop.

Un nouveau fichier CSS n’est réel que lorsqu’il est ajouté dans `css-bundles.js` et que le LIVE reste sans orphelin ni source manquante.

---

## 4. Ownership des sélecteurs critiques

Le principe n’est plus « un selector littéral dans un seul fichier à tout prix ». Le contrat est : **un owner sémantique principal + uniquement des adaptations contextuelles explicites**. Le LIVE signale les selectors multi-owner pour revue ; ils ne constituent pas une dette lorsqu’ils correspondent au tableau ci-dessous et que cascade/spécificité restent à zéro.

| Sélecteur | Owner principal | Adaptations autorisées |
|---|---|---|
| `.k-chip` | `categories.css` | `interactions.css` pour états/transition |
| `.k-cats-shell` | `categories.css` | `boutique-desktop.css` pour desktop |
| `.k-hero-cats-sticky` | `hero.css` pour la base | `categories.css` pour l’état/skin desktop canonique |
| `#k-subcats-wrap`, `.k-subchip` | `boutique-desktop.css` structure | `categories.css` pour theming catégorie |
| `.k-grid` | `products.css` | `cart.css` contexte panier, `layout.css` contrainte structurelle desktop |
| `.k-card` | `products.css` | `categories.css` état d’entrée, `boutique-desktop.css` interaction desktop |
| `.k-card-add`, `.k-card-fav` | `products.css` | `cart.css` sizing/contexte panier desktop |
| `.k-side-cart` | `layout.css` pour présence mobile | `boutique-desktop.css` pour coque desktop ; `side-cart-desktop-polish.css` pour descendants/polish |
| `#k-desktop-catalog-wrap` | `layout.css` | aucune seconde coque concurrente |
| `.k-header` | `layout.css` | `mobile-shell-convergence.css` pour convergence mobile ciblée |
| `.k-hero-media` | `hero.css` | `hero-ultra-mobile.css`, `mobile-catalog-convergence.css` pour adaptations mobiles ciblées |
| `.k-modal` | `modal-shell.css` | `modal-product.css` pour contexte PDP desktop ciblé |

Toute nouvelle adaptation doit répondre aux trois conditions : contexte identifiable, propriété non concurrente avec une valeur différente, et owner/documentation explicites.

---

## 5. Variables CSS runtime owned par JS

Ces variables sont posées par le runtime et ne doivent pas recevoir une valeur métier concurrente depuis CSS :

| Variable | Producteur(s) actuel(s) |
|---|---|
| `--pager-top` | `b-pager.js`, `hero-bootstrap.js` |
| `--pager-h` | `b-pager.js`, `b-subcat.js`, `hero-bootstrap.js` |
| `--pager-w` | `b-pager.js` |
| `--bnav-h` | `b-pager.js` |
| `--modal-scroll-y` | `b-modal-core.js` |

Les multi-producteurs de pager correspondent à la mesure/bootstrap du même contrat. Ajouter un nouveau producteur exige une justification d’ownership, pas seulement un `setProperty()` supplémentaire.

---

## 6. Discipline de modification

Pour toute modification CSS structurelle :

1. modifier la source owner, jamais `css/dist/*` directement ;
2. reconstruire avec `deploy-css.js` ;
3. exécuter `css-guard` et `css-specificity-guard` ;
4. exécuter `check-important` si une occurrence `!important` est touchée ;
5. exécuter `boutique:audit` ;
6. régénérer `BOUTIQUE_ARCHITECTURE_LIVE.md` si l’inventaire, les owners, les variables runtime ou une métrique d’architecture changent ;
7. ne baisser une baseline qu’après suppression prouvée de dette ; ne jamais la relever pour accepter une régression.

---

## 7. État de référence Debt Zero — 29/08/2026

La référence attendue après B2/B3 est :

- CSS orphelins : **0** ;
- sources bundle manquantes : **0** ;
- tokens cassés : **0** ;
- conflits de cascade suivis : **0** ;
- overrides de spécificité suivis : **0** ;
- dette `!important` ouverte : **0** ;
- `!important` physiques : **3**, tous appartenant au guard revu `desktop-mobile-drawer-neutralization` ;
- audit Boutique : vert.

Les nombres d’inventaire, d’hex et de selectors multi-owner sont **observatoires** : ils viennent du LIVE et peuvent évoluer avec le produit. Les compteurs de dette structurelle, eux, sont des cliquets exécutables et restent à zéro.

---

*Document normatif réaligné sur l’architecture Boutique 2026-08. Pour la photographie exacte du commit courant : `npm run boutique:arch`.*
