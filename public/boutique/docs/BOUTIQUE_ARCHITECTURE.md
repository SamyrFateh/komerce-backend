# Komerce Boutique — Architecture

> **Document normatif.** Décrit ce qui doit être vrai. Court par discipline.
> Si tu trouves une contradiction entre ce document et le code, **le code a tort** —
> ouvre une PR pour le corriger. Si la règle elle-même est mauvaise, **change-la ici**
> dans la même PR.
>
> L'état réel du code à un instant T est dans `BOUTIQUE_ARCHITECTURE_LIVE.md`,
> régénéré par `npm run boutique:arch`. Ce fichier-ci, jamais.
>
> Le garde-fou : `npm run boutique:audit` plante le build si le code diverge.

---

## 1. Invariants (le build casse si violés)

### I-1. Aucun CSS orphelin
Tout fichier `css/*.css` est soit listé dans `scripts/bundle-css.js`, soit supprimé du disque.
Pas de troisième option. Pas de "fichier conservé pour cache résiduel" ; le cache se règle
avec un `?v=N`, pas avec un fichier vide.

### I-2. Un sélecteur, un owner
Voir tableau §3. Un sélecteur listé est défini **uniquement** dans son owner déclaré.
Si tu as besoin d'override desktop d'une règle mobile, l'override va dans l'owner desktop,
pas dans un troisième fichier.

### I-3. Aucun hex hors `tokens.css`
Sauf exception listée dans `scripts/audit-arch.js` (allowlist explicite, justifiée).
Toute couleur passe par une variable CSS sémantique.

### I-4. Aucune valeur `var(--token)xxx`
Le pattern `var\(--[a-z-]+\)[0-9a-f]{2,}` est interdit. C'est le résidu d'une migration
find-replace qui a transformé des hex 6 chiffres en charabia (`#fff8e7` → `var(--white)8e7`),
silencieusement invalide côté navigateur.

### I-5. Toute modif desktop est sous `@media (min-width: 900px)`
Sauf si la règle vit dans un fichier listé `desktop-only` au §2 (chargé sans MQ mais
servant uniquement le desktop par convention). Aucune règle globale ne touche un sélecteur
mobile-critique (voir §4).

### I-6. Les variables CSS owned par JS ne sont jamais posées par CSS
Liste verrouillée : `--pager-top`, `--pager-h`, `--pager-w`, `--bnav-h`, `--modal-scroll-y`.
Posées exclusivement via `element.style.setProperty()` depuis le JS owner déclaré au §5.

### I-7. La dette structurelle ne peut que décroître (cliquet)
Deux compteurs sont gelés dans une baseline et ne peuvent **jamais augmenter** :

1. **Breakpoints hors charte** — tout `@media` doit cibler `900px` (desktop) ou `1200px` (large).
   Tout autre breakpoint (`480`, `600`, `768`…) est une violation. Baseline :
   `scripts/.breakpoints-baseline.json`. Vérifié par `npm run check:breakpoints`.
2. **Exceptions multi-owner** — la liste `allowedAlso` / scopes multiples de
   `scripts/audit-boutique-arch.js` (I-2) est une **dette à rembourser**, pas un débarras.
   On ne peut pas y ajouter une entrée pour faire taire `audit:arch` : il faut résoudre
   le conflit (rapatrier le sélecteur chez son owner unique).

**Pourquoi cet invariant existe** : sans lui, I-2 et I-5 se contournent en ajoutant des
exceptions. Le build reste vert pendant que le contrôle réel se dégrade (cas observé au
30/05/2026 : 29 exceptions multi-owner, 35 breakpoints hors charte, alors qu'`audit:arch`
était vert). I-7 transforme ces listes en cliquet : elles ne tournent que vers 0.

**Quand on résout une violation** : régénérer la baseline avec `npm run check:breakpoints:save`
pour verrouiller le gain — on ne pourra plus jamais remonter au-dessus du nouveau compte.

---

## 2. Inventaire CSS — statut attendu

| Fichier | Statut | Rôle |
|---|---|---|
| `tokens.css` | bundle `base` | Variables CSS — source unique pour couleurs/typo/radius/ombres |
| `reset.css` | bundle `base` | Reset box-model, scroll-behavior |
| `layout.css` | bundle `base` | Structure : `#k-hero-fixed-wrap`, `#k-page-scroll`, `.k-side-cart` **mobile uniquement** |
| `hero.css` | bundle `base` | `.k-hero` base, `.k-hero-cats-sticky` base mobile |
| `categories.css` | bundle `components` | `.k-chip` base mobile, couleurs par catégorie |
| `products.css` | bundle `components` | `.k-grid`, `.k-card` base |
| `modal.css` | bundle `components` | Cycle modal, overlay, drawer. **Co-owner avec `js/view-models/modal-view-model.js`** pour les 10 classes contractuelles `.k-modal--*` (cf. `BOUTIQUE_SOURCE_OF_TRUTH.md` §3B) |
| `cart.css` | bundle `components` | Panier complet, `.k-card-add`, `.k-card-fav` |
| `interactions.css` | bundle `components` | Animations, toasts, transitions chips |
| `hero-cart-proxy.css` | bundle `components` | Proxy mobile uniquement, masque `.k-hero-bubble` |
| `group-cart-flow.css` | bundle `components` | **Owner officiel** styles Groupe / panier partagé : cockpit créateur, vue participant, mobile compact. `b-group-view.js` ne doit plus injecter de CSS (injectStyles = no-op). |
| `shared-followup.css` | bundle `components` | Followup partagé (résiduel) |
| `boutique-desktop.css` | bundle `desktop` | **Owner desktop ≥900px** : chips, sticky bar, side-cart, k-card hover, mega-nav |
| `desktop-commerce-skeleton.css` | bundle `desktop` | Layout desktop : header, hero shape, `#k-desktop-catalog-wrap` grid |
| `event.css` | bundle `event` | Pages événement |

**Aucun autre `.css` ne doit exister dans `css/`.** Si présent, l'audit échoue.

### Statut actuel des fichiers — clos depuis le 20/05/2026

La version v1.0 de cet inventaire listait 7 fichiers CSS "à supprimer ou intégrer".
**Décision prise et appliquée** :

- `boutique-wow.css` — supprimé
- `desktop-horizontal-nav.css` — supprimé
- `mini-cart.css`, `cart-groups.css`, `cart-product-open.css` — supprimés
- `group-cart-flow.css` et `shared-followup.css` — **intégrés au bundle `components`** (cf. `scripts/bundle-css.js`)

Le dossier `css/` ne contient plus aucun orphelin (vérifié `npm run audit:arch`).

---

## 3. Ownership CSS — table des sélecteurs critiques

Un sélecteur listé ici est défini **uniquement** dans son owner. Si tu en as besoin ailleurs,
soit tu importes le fichier owner (cascade), soit tu changes l'owner ici dans la même PR.

| Sélecteur | Owner(s) autorisé(s) | Breakpoint | Justification |
|---|---|---|---|
| `.k-chip` (base skin) | `categories.css` | base | Owner composant |
| `.k-chip` (overrides desktop) | `boutique-desktop.css` | ≥900px | Owner desktop |
| `.k-chip.transitioning` (animation) | `interactions.css` | tous | Owner animations inter-composants |
| `.k-cats-shell` (base) | `categories.css` | base | Owner composant |
| `.k-cats-shell` (desktop) | `boutique-desktop.css` | ≥900px | Owner desktop |
| `.k-cats-shell` (contexte hero mobile) | `hero.css` | base | Adaptation contextuelle enfant-hero uniquement |
| `.k-cats-shell` (max-width ≥1500px) | `desktop-commerce-skeleton.css` | ≥1500px | Contrainte largeur max — rôle skeleton |
| `.k-hero-cats-sticky` | `hero.css` | base | Owner composant |
| `.k-hero-cats-sticky` (desktop) | `boutique-desktop.css` | ≥900px | Owner desktop |
| `#k-subcats-wrap`, `.k-subchip` | `boutique-desktop.css` | ≥900px | Lot I-2-A |
| `.k-grid` (base layout) | `products.css` | tous | Owner composant |
| `.k-grid` (animations slide) | `interactions.css` | tous | Owner animations — rôle explicite du fichier |
| `.k-grid` (overflow-x fix sticky) | `layout.css` | ≥900px | Fix structural global, commenté et justifié |
| `.k-grid` (contexte flat-subcat panier) | `cart.css` | tous | Adaptation contextuelle panier uniquement |
| `.k-sec-grid` (base layout) | `products.css` | tous | Owner composant |
| `.k-sec-grid` (padding contextuel sections) | `categories.css` | tous | Padding spécifique au contexte section-catégorie |
| `.k-card` (base) | `products.css` | tous | Owner composant |
| `.k-card` (skin desktop : radius, shadow) | `desktop-commerce-skeleton.css` | ≥900px | Skin desktop global — rôle skeleton (§7) |
| `.k-card` (hover overlay) | `boutique-desktop.css` | ≥900px | Owner desktop interactions |
| `.k-card-add`, `.k-card-fav` (base + états) | `products.css` | tous | Owner composant — boutons sur la card |
| `.k-card-add`, `.k-card-fav` (sizing desktop) | `cart.css` | ≥900px | Sizing dans contexte panier ouvert |
| `.k-card-fav` (opacité hover desktop) | `boutique-desktop.css` | ≥900px | Comportement hover desktop |
| `.k-side-cart` (mobile : display:none) | `layout.css` | <900px | Owner mobile |
| `.k-side-cart` (desktop : tout) | `boutique-desktop.css` | ≥900px | Owner desktop |
| `#k-desktop-catalog-wrap` (grid layout) | `desktop-commerce-skeleton.css` | ≥900px | Owner layout desktop |
| `#k-desktop-catalog-wrap` (overflow/sticky fixes) | `layout.css` | ≥900px | Fix structurel sticky side-cart — ne peut pas vivre dans skeleton (commenté PATCH#227) |
| `.k-header` (desktop) | `desktop-commerce-skeleton.css` | ≥900px | Owner desktop |
| `.k-hero-media`, `.k-hero-mini-slogan` (desktop) | `desktop-commerce-skeleton.css` | ≥900px | Owner desktop |
| `.k-modal` (desktop overrides) | `desktop-commerce-skeleton.css` | ≥900px | Owner desktop |

**Note importante sur `.k-side-cart`** : l'état actuel a deux owners (layout.css + skeleton.css)
avec des `top` incompatibles. C'est la **violation principale** à traiter en priorité.
Décision : tout va dans `boutique-desktop.css`, layout.css garde uniquement `display:none` mobile.

**Principe de légitimation** : un fichier peut toucher un sélecteur hors de son owner principal
dans trois cas strictement définis — (1) animation/transition (owner : interactions.css),
(2) adaptation contextuelle explicitement commentée (enfant d'un composant spécifique),
(3) contrainte de layout global commentée et non reproductible dans l'owner principal.

---

## 4. Sélecteurs mobile-critiques — interdits aux règles globales

Ces sélecteurs participent à la mécanique fragile mobile (hero fixed, pager, cage scroll).
Toute règle qui les cible **sans `@media (min-width: 900px)`** doit vivre dans son owner mobile
déclaré, jamais ailleurs.

- `#k-hero-fixed-wrap` (owner : `layout.css`)
- `#k-page-scroll` (owner : `layout.css`)
- `.k-hero` (owner : `hero.css`)
- `.k-chip` (base) (owner : `categories.css`)
- `.k-cats-shell` (base) (owner : `categories.css`)
- `.k-bottom-nav` (owner : `layout.css`)

---

## 5. Ownership JS — variables CSS posées au runtime

| Variable CSS | Owner JS | Méthode |
|---|---|---|
| `--pager-top` | `b-pager.js` | `document.documentElement.style.setProperty` |
| `--pager-h` | `b-pager.js` | idem |
| `--pager-w` | `b-pager.js` | idem |
| `--bnav-h` | `b-pager.js` | idem |
| `--modal-scroll-y` | `b-modal.js` | idem |

Aucun CSS ne définit ces variables. Aucun autre JS ne les pose.

---

## 6. Fichiers verrouillés — review obligatoire

Modifier ces fichiers sans review explicite est interdit. Ils portent la mécanique
qui fait que le mobile marche. Si tu dois toucher, tu ouvres une PR isolée avec un
seul de ces fichiers en diff.

- `js/b-pager.js` — moteur cage mobile + ghost loop
- `js/b-store.js` — refs DOM partagées, `initDom()`
- `js/b-scroll-owner.js` — détection mobile/desktop, scroll owner
- Script inline `<body>` dans `index.html` (lignes ~480-550) — proxy `window.scrollY`

---

## 7. Séquence de chargement — règles

1. CSS bundlés chargés dans l'ordre du `<head>` : `base` → `components` → `desktop` → `event`.
   Cet ordre est la cascade. Skeleton charge après boutique-desktop ; donc skeleton gagne
   sur les sélecteurs partagés — **c'est précisément pour ça que la table §3 verrouille
   `desktop-commerce-skeleton.css` au layout, pas au skin des composants**.

2. Script inline `<body>` exécuté avant tout module ES (setupMobile, setupDesktop, proxy scrollY).

3. `komerce-api.js` synchrone bloquant.

4. `main.js` type=module → import tree (voir `BOUTIQUE_ARCHITECTURE_LIVE.md` pour l'arbre généré).

5. `DOMContentLoaded` → `init()` dans `boutique.js`, ordre strict :
   `initDom` → `installScrollOwner` → `updateCartBadge` → `setupCats` → ... → `loadProducts`.

6. Desktop uniquement (≥900px) : `setupDesktopUpgrade()` après DOMContentLoaded, idempotent
   via flag `_desktopUpgradeDone`.

L'ordre §5 n'est pas modifié sans review équivalente à §6.

---

## 8. Process — toute PR doit passer

```bash
npm run boutique:audit   # plante si invariants §1 violés
npm run boutique:arch    # régénère BOUTIQUE_ARCHITECTURE_LIVE.md
git diff boutique/docs/BOUTIQUE_ARCHITECTURE_LIVE.md   # diff de la photo réelle
```

Si `audit:arch` passe et que le diff de `LIVE` est cohérent avec l'intention de la PR,
la PR est mergeable côté archi. Le visuel et le fonctionnel restent à valider à part.
