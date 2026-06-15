# Komerce Boutique — Audit « qui vit où » + remise au propre

> **Date : 2026-06-15.** Déclencheur : « impossible de positionner un simple
> texte sous le hero après 100 itérations ». Cet audit répond à *pourquoi*, et
> trace ce qui a été corrigé vs ce qui reste (avec la raison).

---

## TL;DR — le diagnostic en une phrase

**Le CSS n'était pas le problème.** Le pipeline `dist/` est en phase avec les
sources, le CSS source est discipliné (namespacing `k-`, peu de `!important`).
Le vrai sujet : **la mise en page verticale sous le hero appartient au
JavaScript, pas au CSS.** Tant qu'on itère en CSS sur une valeur que le JS
réécrit en `style` inline, rien ne bouge.

---

## 1. Pourquoi « texte sous le hero » est impossible en CSS

Trois faits enchaînés :

1. Sur mobile, `#k-hero-fixed-wrap` (bannière **+** barre de catégories) est en
   `position: fixed` — `layout.css:20`. Le hero est **hors flux** : « sous le
   hero » n'est pas une notion de flux, c'est un vide à combler à la main.
2. Ce décalage est mesuré au runtime (`getBoundingClientRect().bottom`) et écrit
   en **`style.top` inline** sur `#k-page-scroll`. Un style inline bat toujours
   la cascade : aucune règle `.css` ne peut gagner.
3. **Deux** fonctions écrivent ce `top`, avec des ensembles d'éléments
   **différents** → la dernière exécutée gagne (effet « ça saute ») :
   - `b-pager.js` → `_recalcPagerVars()` : mesure `.k-header` + hero + sticky-bar
     + cats, écrit `style.top` **et** `--pager-top`.
   - `b-store.js` → `updateMobileScrollTop()` : mesure hero + sticky-bar + cats
     **sans** `.k-header`, écrit `style.top`.

➡️ **Action restante (non faite, voir §6) :** une seule fonction propriétaire
écrit `--pager-top` ; le CSS positionne `#k-page-scroll` via `top: var(--pager-top)` ;
plus aucun `style.top` inline. Le texte sous le hero redevient un simple enfant
du scroller.

---

## 2. Carte d'ownership — zone hero / sous-hero

| Élément | Owner CSS | Positionné par | Note |
|---|---|---|---|
| `#k-hero-fixed-wrap` | `layout.css:20` (mobile `fixed`), `:656` (desktop `static`) | CSS | hors flux en mobile |
| `.k-hero*` (bannière) | `hero.css` | CSS | namespacé, propre |
| `.k-hero-cats-sticky` | `hero.css` + `categories.css` | CSS | hauteur **variable** (sous-cats) |
| `#k-page-scroll` (scroller mobile) | `layout.css` | **JS inline** (`b-pager`, `b-store`) | ⚠ source du blocage |
| `--pager-top/-h/-w`, `--bnav-h` | — | `b-pager.js _recalcPagerVars()` | doit devenir l'**unique** canal |
| `#k-catalog-section` (contenu) | `layout.css:1132` | CSS (`padding-top`) | compense le hero fixe |

**Doublon HTML à trancher :** deux systèmes de slogan coexistent —
`.k-hero-mini-slogan--premium` (dans la bannière, `index.html:180`) et
`.k-hero-title--premium` (dans la barre sticky, `index.html:236`). Choisir un
owner unique.

---

## 3. Dispersion « JS impose la layout » (91 écritures)

Mesuré par `scripts/check-no-css-injection.js` (avertissements, non bloquant) :

| Fichier | Écritures `.style.top/height/position/transform` |
|---|---|
| `b-modal-core.js` | 24 |
| `b-cart-pill.js`, `b-cart.js`, `b-mini-cart.js` | 10 chacun |
| `b-pager.js` | 8 |
| `b-phone.js`, `b-subcat.js` | 5 chacun |
| autres (9 fichiers) | 1–4 |

La plupart sont légitimes (animations, positionnement de modale). Le point dur
reste le **décalage du scroller** (§1), à concentrer en un propriétaire.

---

## 4. Statut des `!important`

Avant : 7 dans le CSS + **2 cachés dans une chaîne JS** (invisibles à l'audit).

| # | Lieu | Verdict | Fait |
|---|---|---|---|
| A1 | `cart.css` checkout body (mobile) | battu par `.k-order-overlay.open .k-order-body` (0-3-0) → rescopé | ✅ retiré |
| A2 | `cart.css` checkout body (@900) | idem | ✅ retiré |
| A3 | `group-cart-flow.css` `--payment` | mort (gagne déjà par ordre source) | ✅ retiré |
| A4 | `identity.css` `--sending` | passé en 0-2-0 | ✅ retiré |
| B1-3 | `boutique-desktop.css:1188-90` (garde drawer desktop) | **défend contre le JS** qui rouvre le drawer | ⏸️ après coupure JS + vérif appareil |
| — | `share-cart.css:10-11` (badges) | étaient cachés dans le JS, désormais visibles | ⏸️ kill-switch, à vérifier |

Toutes les suppressions A1–A4 sont **iso-rendu par construction** (même propriété,
même valeur, gagnent par spécificité au lieu de `!important`).

---

## 5. Injection CSS par le JS — corrigé (doctrine §1)

Trois `<style>` injectés au runtime (la « cascade fantôme » que la doctrine
nomme) ont été **rapatriés verbatim** dans des `.css` owners et les fonctions
vidées en no-op (appels conservés) :

- `b-group-view.js ensureSnapshotStyles()` → **`group-cart-flow.css`** (snapshot produit)
- `b-share-cart.js ensureSidebarStyles()` + `ensureStyles()` → **nouveau `css/share-cart.css`** (ajouté au bundle `components`)

Bonus : la migration a fait remonter un **bug latent** (`}` orpheline) qui dormait
dans la chaîne JS, désormais corrigé.

**Nouveau garde-fou exécutable :** `scripts/check-no-css-injection.js`, câblé dans
`check:all` et `precommit`. Il **échoue** sur toute nouvelle injection `<style>`
(échappatoire explicite `// css-injection-allow: <raison>`) et **liste** les
écritures de layout inline. La doctrine §1 n'est plus documentaire : elle est
enforced.

---

## 6. Reste à faire (nécessite une vérification sur appareil)

1. **Consolider le décalage hero** (§1) — *débloque le symptôme d'origine.*
   Fusionner `updateMobileScrollTop` dans l'unique `_recalcPagerVars`, supprimer
   les `style.top` inline, ajouter `#k-page-scroll { top: var(--pager-top); }` en CSS.
2. **Retirer B1–B3** une fois le drawer mobile empêché de s'ouvrir en desktop
   (classe d'état plutôt que `style` inline).
3. **Trancher le doublon de slogan** (§2).
4. **Badges `share-cart.css:10-11`** : confirmer le kill-switch, dé-`!important`.

> Règle d'or confirmée par cet audit : **ce qui n'est pas enforcé dérive.**
> La doctrine §1 existait depuis juin ; elle a dérivé faute de check exécutable.
