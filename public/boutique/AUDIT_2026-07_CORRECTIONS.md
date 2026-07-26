# Audit boutique 2026-07 — rapport de correction

**Méthode :** chaque cause racine est mesurée dans un Chromium réel contre les
bundles livrés, jamais déduite par lecture de code. Chaque correctif est
re-mesuré après application. Le harnais est livré (`harnais/geometry/`).

---

## Résumé

| # | Symptôme signalé | Statut | Cause racine |
|---|---|---|---|
| 1 | Hero non sticky en modale desktop | ✅ corrigé | Double centrage vertical (`align-self:center` **+** `margin:auto`) |
| 2 | Stock absent | ⚠️ pas un bug front | Catalogue en `LEGACY_VARIANTS` → `sellable_units` vide par conception |
| 3 | Flash du hero desktop « en gros » | ✅ corrigé | Aucun plafond de hauteur sur le repli sans `k-home-premium-v1` |
| 4 | Cartes disparues après recherche | ✅ corrigé | `state.filtered` non restauré au clic sur un résultat |
| 5 | *(non signalé — trouvé en audit)* Bouton « retour en haut » modale | ✅ corrigé | `z-index` sous l'overlay **+** classe CSS désalignée du JS |

---

## 1 — Hero sticky modale desktop

`modal-media.css` posait `align-self: center` **et** `margin: auto` sur
`.k-modal-img-wrap`, en écrasant par ordre de bundle le `align-self: start` de
`modal-shell.css` (spécificité identique). Un item centré n'a aucune amplitude
de collage : le sticky défilait 1:1.

Mesures (`.k-modal-img-wrap`, produit à 36 variantes, 1440 px) :

| Variante testée | tops @ scroll [0,100,200,300] |
|---|---|
| État initial | `[509, 409, 309, 209]` ❌ |
| `align-self:start` seul | `[509, 409, 309, 209]` ❌ inchangé |
| `margin-block:0` seul | `[509, 409, 309, 209]` ❌ inchangé |
| **Les deux ensemble** | `[22, 0, 0, 0]` ✅ |
| `grid-row:1` seul | `[498, 398, 298, 198]` ❌ |

`509 = (1397 − 380) / 2` : le centrage était arithmétiquement démontrable.

**Le piège est qu'il faut neutraliser les deux variables en même temps.** Une
traque précédente avait testé `align-self:start` seul — y compris en inline
`!important` — n'avait rien vu bouger, et en avait conclu à un bug Chromium sur
`position:sticky` + item de grille. Il n'y en a pas.

Note : `grid-row: 1 / 3` n'avait jamais été corrigé dans les sources contrairement
à ce qu'affirmait le transcript précédent — mais c'est un faux coupable, mesuré
sans effet.

**Correctif** — `css/modal-media.css` : `margin-inline: auto` + `margin-block: 0`
+ `align-self: start`. `align-self` retiré de `modal-shell.css` (owner unique).

**Vérifié** à 1440 / 1024 / 950 px avec 36 variantes, plus un cas produit court
en non-régression.

**Contrepartie assumée** — pour un produit court, le hero est calé en haut de sa
colonne au lieu d'être centré. C'est inhérent au sticky. À valider côté maquette.

---

## 2 — Stock

Chaîne confirmée :

1. `services/catalog-product-detail.js` → `buildSellableUnits()` retourne `[]` si
   `inventory_model !== 'SKU'` ;
2. `js/view-models/modal-selection-model.js` → `deriveLegacyState()` pose
   `selection_supported: false` ;
3. `js/b-modal-desktop-product.js` → `renderStock()` masque le bloc et sort.

Or `migrations/104_product_skus.sql` pose `DEFAULT 'LEGACY_VARIANTS'`, et le
commentaire de vérification de la migration dit lui-même :
*« attendu : 100% LEGACY_VARIANTS »*.

**Aucun correctif front ne changera quoi que ce soit.** À mesurer en prod :

```sql
SELECT inventory_model, count(*) FROM products GROUP BY 1;
```

Puis, si la couverture est faible :

```bash
node scripts/check-sku-coverage.js                       # audit
node scripts/check-sku-coverage.js --backfill            # dry-run
node scripts/check-sku-coverage.js --backfill --apply --switch-ready
```

---

## 3 — Flash du hero desktop

Le repli `.k-hero-img { aspect-ratio: 1600/525 }` s'applique en pleine largeur
tant que `k-home-premium-v1` n'a pas basculé `.k-hero-media` en grid 50/50.
Aucun plafond de hauteur nulle part.

| Viewport | Nominal | Repli avant | Repli après |
|---|---|---|---|
| 900 px | 242 px | 295 px | 240 px |
| 1280 px | 220 px | 420 px | 240 px |
| 1440 px | 224 px | **473 px (+111 %)** | 240 px |
| 1920 px | 224 px | 505 px | 240 px |

**Correctif** — `css/hero.css` : `html:not(.k-home-premium-v1) .k-hero-img
{ max-height: 240px }`. Scopé au seul cas de repli ; la branche premium est
strictement inchangée (valeurs identiques au pixel, avant/après).

---

## 4 — Grille vide après une recherche

`_searching` (`b-catalog.js` ~L399) est dérivé de `dom.searchInput.value`, alors
que la liste rendue vit dans `state.filtered`. Le clic sur un résultat vidait
l'input **sans** restaurer `state.filtered`. Au rendu suivant, `_searching`
repassait à `false` et `_balancedPick()` s'appliquait à la liste étroite — or il
jette toute section `< MIN_PER_SECTION (4)` et tout reliquat impair.

| Résultats de recherche | Cartes après clic |
|---|---|
| 1 · 2 · 3 | **0** ❌ |
| 5 | 4 ✅ |

C'est le nombre de résultats qui explique le « parfois » du signalement.

**Correctif** — helper unique `_resetSearchFilter()`, appelé aux deux points de
sortie de la recherche (saisie < 2 caractères, et clic sur un résultat).

---

## 5 — Bouton « retour en haut » de la modale *(trouvé en audit)*

Deux défauts empilés rendaient la fonctionnalité totalement morte :

1. `z-index: 10` alors que `.k-modal-overlay` est à 300 et `.k-modal` à 400.
   `document.elementFromPoint()` au centre du bouton renvoyait
   `#k-modal-overlay` — le clic atterrissait sur l'overlay, donc **fermait la
   modale** au lieu de remonter.
2. La règle de révélation ciblait `.show`, alors que le seul writer
   (`b-modal-product.js`, IntersectionObserver) pose `.visible`. `opacity`
   restait à 0 et `pointer-events` à `none` en permanence.

**Correctif** — `modal-shell.css` : `z-index: 420`, sélecteur aligné sur
`.visible`, et suppression du bloc de base 100 % mort (toutes ses déclarations
étaient redéclarées plus bas dans le même fichier). −7 conflits de cascade.

---

## Gouvernance : trois gates étaient aveugles

### `css-guard` annonçait 0 conflit — il y en avait 117

Deux défauts du parser, prouvés sur cas synthétique :

- toute règle **mono-ligne** ressortait avec `props: {}` — zéro propriété lue.
  Or `modal-shell.css` est écrit dans ce style compact ;
- sur une ligne à déclarations multiples, seule la première clé était retenue,
  avec tout le reste comme valeur :
  `position: sticky; top: 0; align-self: start`
  → `{ position: "sticky; top: 0; align-self: start" }`.

**Le conflit `align-self: start` vs `center` — cause racine du bug n°1 — était
donc structurellement indétectable par le gate créé exactement pour ça.**

Parser corrigé (découpage respectant parenthèses et chaînes) + neutralisation
des commentaires multi-lignes, sinon la prose du dépôt qui cite du CSS fabrique
de faux conflits. Un gate bruyant est un gate ignoré.

### `check-zindex-contract` scannait les commentaires

Le matcher lisait la source brute : un commentaire citant `.k-modal-overlay`
était pris pour une occurrence réelle, et le gate attribuait alors le `z-index`
de la règle suivante — sans rapport. Même angle mort. Corrigé de la même façon.

### `event.css` échappait entièrement au pipeline

Chargé **en dernier** dans le `<head>` (donc prioritaire en cascade), mais absent
de `BUNDLES` dans `scripts/css-bundles.js` : `deploy-css.js` ne l'a jamais
régénéré. Contenu réel : **une copie figée de `tokens.css` seul** (341 variables),
alors que `base.css` embarque déjà `tokens`.

Contenu identique aujourd'hui (0 divergence) — mais risque démontré :

```
Après modification de --sand dans tokens.css + rebuild :
  base.css   → --sand: #FF0000     (valeur voulue)
  event.css  → --sand: #FDFAF5     ← chargé après, donc gagne
```

Tout futur changement de token aurait été **silencieusement annulé**. Aucune page
`/event/*` n'existe ni dans le repo ni dans les routes → `<link>`, fichier et
entrées `DIST_FILES` retirés. −26 Ko sur chaque chargement de page.

### Nouveau gate : `check-sticky-integrity.js`

Interdit qu'un `position: sticky` coexiste avec un centrage vertical
(`align-self: center`, `margin[-block|-top|-bottom]: auto`). Testé dans les deux
sens : vert sur le repo corrigé, `exit 1` sur la régression réinjectée, en
pointant **les deux** déclarations fautives. Branché dans `check:visual-lock`.

### Bundle fantôme

`public/boutique/dist/` contenait une copie périmée de `base.css` et
`components.css` (tailles divergentes de `css/dist/`), non chargée, 0 référence.
Supprimé.

---

## Fichiers touchés

**Correctifs produit**
- `css/modal-media.css` — fix sticky (centrage vertical retiré)
- `css/modal-shell.css` — ownership `align-self`, `z-index` back-top, bloc mort retiré
- `css/hero.css` — plafond du hero de repli
- `js/b-catalog.js` — `_resetSearchFilter()`
- `index.html` — `event.css` retiré, cache-busters bumpés

**Outillage**
- `scripts/css-guard.js` — parser corrigé
- `scripts/check-zindex-contract.js` — matcher insensible aux commentaires
- `scripts/check-sticky-integrity.js` — **nouveau**
- `scripts/css-specificity-guard.js`, `check-cache-buster.js` — `event.css` retiré
- `package.json` — `check:sticky` branché dans `check:visual-lock`
- `harnais/geometry/` — **nouveau** harnais de mesure + README

**Supprimés** : `public/boutique/dist/`, `css/dist/event.css`

**Baselines refigées** : `css-guard` 110 (était 1, faussement), `css-specificity-guard`

---

## Reste à traiter

1. **20 conflits invariants** restants. Triés par mesure : la majorité sont du
   dead code (la règle tardive gagne et c'est la bonne). Vérifié notamment que
   `body { overflow-y }` résout bien à `visible` en desktop — un sticky
   descendant de `body` colle (top 79 → 0), donc pas de scroll-container parasite.
   À nettoyer sans urgence.
2. **Couverture SKU** — prérequis au stock, décision produit.
3. **E2E** — non lancés (nécessitent backend + base). Les correctifs 1, 3 et 5
   sont couverts par le harnais ; le 4 par `repro-search-grid.js`.
