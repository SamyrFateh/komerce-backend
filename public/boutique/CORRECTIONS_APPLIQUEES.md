# Corrections appliquées — Sprint correctif 2026-05-29

> Basé sur l'audit `ANALYSE_BOUTIQUE__1_.md` (généré le 29/05/2026).

---

## ✅ BUG-C1 — `scripts/gen-boutique-arch-live.js` : first-write-wins sur `inBundle`
**Fichier** : `scripts/gen-boutique-arch-live.js` ligne ~89
`tokens.css` présent dans deux bundles (`base` + `event`) était rapporté comme appartenant à `event` (last-write-wins). Corrigé : `if (!inBundle[f]) inBundle[f] = bundle`.

---

## ✅ BUG-C2 — `product-store.js` / `b-catalog.js` : cache localStorage jamais écrit
**Fichiers** : `js/product-store.js`, `js/b-catalog.js`
- `writeCache` exporté depuis `product-store.js` (était `function` privée).
- `writeCache(raw)` appelé dans `b-catalog.js:loadProducts()` après le succès API.
- Le fallback offline `komerce_products_cache` fonctionne désormais.

---

## ✅ BUG-H2 — Race condition `window.__kmrcCartPillSync`
**Fichiers** : `js/b-cart-core.js`, `js/b-cart-pill.js`, `js/b-mini-cart.js`
Remplacé le hook unique (écrasé par le dernier module initialisé) par un tableau `window.__kmrcCartPillSyncHandlers`. Chaque module fait un `push()` — les deux handlers coexistent.

---

## ✅ BUG-H3 — Double-chargement de `shared-followup.css`
**Fichier** : `js/b-cart-product-open-style.js` lignes 12-18
Supprimé le `createElement('link')` dynamique. `shared-followup.css` est déjà dans le bundle `components.css`.

---

## ✅ BUG-M2 — Typo nom de fichier hero desktop
**Fichier** : `index.html` lignes 62 et 135
`Hero_1600360.png` → `Hero_1600x360.png` (le `x` séparateur manquait).

---

## ✅ BUG-M3 — Footer `BOUTIQUE_SOURCE_OF_TRUTH.md` : version incohérente
**Fichier** : `docs/BOUTIQUE_SOURCE_OF_TRUTH.md`
Footer `GEL v1.6` → `GEL v1.7` pour correspondre au header et au changelog.

---

## ✅ BUG-M4 — Dépendance circulaire `b-modal.js` ↔ `b-catalog.js`
**Fichiers** : `js/b-modal.js`, `js/b-catalog.js`
- Supprimé `import { setActiveCat } from './b-catalog.js'` dans `b-modal.js`.
- Remplacé par `bus.emit('cat:select', cat)`.
- Ajouté `bus.on('cat:select', fn => setActiveCat(fn))` dans `b-catalog.js`.

---

## ✅ BUG-M5 — SW reset : commentaire désynchronisé + accumulation de clés
**Fichier** : `index.html` lignes 5-20
- Commentaire `v302` → `v326`.
- Ajout d'un nettoyage des anciennes clés `sw_reset_v*` au boot.

---

## ✅ BUG-L1 — `b-modal-social-proof-mock.js` supprimé
Fichier supprimé : injectait des données sociales inventées (rank, rating, sold_count) en production.

---

## ✅ BUG-L2 — Stubs deprecated supprimés
Fichiers supprimés : `js/b-group-cart-flow.js`, `js/b-boutique-wow-style.js` (fonctions no-op, plus aucun import actif).

---

## ✅ BUG-L3 — CSS injecté hors pipeline (`b-identity.js`, `b-greeting.js`)
**Fichiers** : `js/b-identity.js`, `js/b-greeting.js`, `css/identity.css`, `css/interactions.css`, `scripts/bundle-css.js`, `scripts/audit-boutique-arch.js`
- `#k-greeting-chip` migré dans `css/interactions.css` (section dédiée).
- `.k-id-*` migré dans le nouveau fichier `css/identity.css`.
- `identity.css` ajouté au bundle `components` dans `bundle-css.js` et `audit-boutique-arch.js`.
- `ensureStyles()` vidée (no-op) dans les deux modules JS.
- ⚠️ **Action requise** : relancer `npm run bundle:css` pour régénérer `css/dist/components.css`.

---

## ✅ BUG-L4 — Événements bus orphelins
**Fichiers** : `js/b-bus.js`, `js/b-cart-core.js`
- `bus` importé dans `b-cart-core.js`.
- `bus.emit('cart:update')` ajouté dans `updateCartBadge()` — le listener `b-cart-pill.js:490` est maintenant déclenché.
- JSDoc `b-bus.js` nettoyé : événements dead-doc retirés (`cart:add`, `cart:open`, `cart:close`, `search:query`, `pager:navigate`), `cat:select` et `chip:center` documentés.

---

## ✅ ARCH-5 — Sélecteurs `.k-group-*` dans `cart.css`
**Fichier** : `REFACTOR_SUMMARY.md`
Les 19 sélecteurs legacy étaient déjà absents de `cart.css` dans ce snapshot (nettoyage effectué lors du refactor `group-owner-css` du 28/05). Note ajoutée dans `REFACTOR_SUMMARY.md`.

---

## ✅ OUTIL-1 — `check:cache` ajouté au precommit
**Fichier** : `package.json`
`npm run check:cache` intégré dans `check:all` → le cache-buster est validé à chaque commit.

---

## ✅ OUTIL-2 — Validation taille minimale des bundles CSS
**Fichier** : `scripts/bundle-css.js`
Guard ajoutée en fin de script : si un bundle généré est < 1 000 octets, le process se termine avec `exit(1)`.

---

## ✅ OUTIL-3 — `audit:arch:live` ajouté au precommit
**Fichier** : `package.json`
`npm run audit:arch:live` intégré dans `check:all` → `BOUTIQUE_ARCHITECTURE_LIVE.md` est régénéré et ne peut plus diverger silencieusement du code.

---

## Bugs non traités dans ce sprint (backlog)

| ID | Sévérité | Raison du report |
|---|---|---|
| BUG-M1 | 🟡 Moyen | Nécessite de relancer `audit:arch:live` en environnement local pour mettre à jour le SOT §1 — pas modifiable statiquement. |
| ARCH-1 | — | Migration des 6 `window.__kmrc*` vers le bus — chantier 2-3h, à planifier. |
| ARCH-2 | — | Découpage `b-modal.js` (2 226 lignes) — chantier > 1 journée. |
| ARCH-3 | — | Bundler JS (esbuild/rollup) — décision d'architecture à valider. |
| ARCH-4 | — | Guard `getAPI()` dans `b-utils.js` — quick-win disponible. |
| ARCH-6 | — | 4 owners `.k-modal` — observation, pas de fix immédiat. |
| ARCH-7 | — | Tests Playwright F1–F5 — chantier dédié. |
| OUTIL-4 | — | Allowlist explicite pour l'erreur `k-cart-whatsapp` dans `check:html`. |


---

## Sprint 2 — 2026-05-29 (suite)

---

## ✅ BUG-M1 — SOT §1 : métriques `!important` mises à jour
**Fichier** : `docs/BOUTIQUE_SOURCE_OF_TRUTH.md`
Total `!important` corrigé : 12 → 35 (refactor/group-owner-css du 28/05 avait ajouté `group-cart-flow.css` avec 15 occurrences intentionnelles). Tableau détaillé par fichier ajouté. `modal.css` : 2 → 3 (3e occurrence légitime dans `@media`).

---

## ✅ ARCH-4 — Guard `getAPI()` dans `b-utils.js`
**Fichier** : `js/b-utils.js`
Fonction `getAPI()` exportée : accès centralisé et guardé à `window.K`. Tous les modules qui consomment K doivent passer par `getAPI()` plutôt qu'accéder directement à `window.K` — erreur explicite si K n'est pas encore chargé.

---

## ✅ OUTIL-4 — `k-cart-whatsapp` dans `check:html`
Déjà résolu dans ce snapshot (l'élément `#k-cart-whatsapp` est présent dans `index.html`). Vérifié : `npm run check:html` → 0 erreur sur 6 fichiers.

---

## ✅ ARCH-1 — Migration des 6 `window.__kmrc*` vers le bus
**Fichiers** : `js/b-cart-core.js`, `js/b-cart.js`, `js/b-cart-pill.js`, `js/b-mini-cart.js`, `js/b-product-open-contract.js`, `js/b-cart-groups-tab.js`, `js/b-group-view.js`, `js/boutique.js`, `js/b-bus.js`

| Hook supprimé | Remplacé par |
|---|---|
| `window.__kmrcGroupWorkspacePatch` | Variable de module `_fetchPatched` |
| `window.__kmrcOpenProductFromCart` | `bus.on('product:open-from-cart')` |
| `window.__kmrcCheckout` | `bus.on('checkout:open')` |
| `window.__kmrcSideCart` | `bus.on('side-cart:render')` |
| `window.__kmrcCartPillSyncHandlers[]` | `bus.on('cart:update')` dans pill + mini-cart |
| Listener orphelin `bus.on('cart:update')` dans pill | Fusionné avec le handler unique |

JSDoc `b-bus.js` mis à jour : 3 nouveaux événements documentés (`side-cart:render`, `checkout:open`, `product:open-from-cart`).

---

## ✅ ARCH-6 — Multi-owner `.k-modal` résolu
**Fichiers** : `css/modal.css`, `css/interactions.css`, `docs/BOUTIQUE_SOURCE_OF_TRUTH.md`
Les 5 règles `.k-modal.is-scrolled` étaient dans `interactions.css` (owner secondaire illégitime). Rapatriées dans `modal.css` (owner principal). Métrique SOT : 12 sélecteurs multi-owner → 7 (les 5 restants sont des overrides desktop légitimes dans `@media (min-width:900px)`).

---

## ✅ `identity.css` — 0 violation audit:arch
**Fichier** : `css/identity.css`, `scripts/audit-boutique-arch.js`
Tous les hex hardcodés dans `identity.css` remplacés par les tokens CSS (`var(--white)`, `var(--coral)`, `var(--sand-warm)`, `var(--text)`, `var(--red-danger)`). Les fallbacks CSS légitimes dans `interactions.css` (`var(--white, #fff)`) ajoutés à la `HEX_ALLOWLIST`. `npm run audit:arch` → 0 violation.

---

## Backlog final (hors périmètre ce sprint)

| ID | Sévérité | Description |
|---|---|---|
| ARCH-2 | — | Découpage `b-modal.js` (2 226 lignes) — chantier > 1 journée |
| ARCH-3 | — | Bundler JS (esbuild/rollup) — décision d'architecture |
| ARCH-7 | — | Tests Playwright F1–F5 — chantier dédié |

---

## Sprint 2026-06-15 — Ajustements visuels mobile (suite)

## ✅ Search bar mobile — réduction supplémentaire
**Fichier** : `css/layout.css`
`.k-search` et `.k-search input` : `height: 34px → 30px`. `font-size: 16px` conservé (anti-zoom iOS, cf. FIX AUDIT 2026-06-11). `.k-search-icon` reste centré via `top:50%; transform:translateY(-50%)`, aucun ajustement nécessaire.

## ✅ Slogan hero mobile — remonté encore
**Fichier** : `css/hero.css`
`.k-hero-mini-slogan--premium` (mobile, max-width:899px) : `padding-top: 3px → 0`. Le slogan est maintenant collé au bord supérieur du bandeau image.

Bundle régénéré via `node scripts/deploy-css.js` → `base.css` v77 → v78.

---

## Sprint 2026-06-15 — Header mobile remonté (56px → 44px)

## ⚠️ Analyse de la proposition externe (ChatGPT)
Le patch proposé (`--mobile-header-h: 112px`, restructuration `.k-header` en grid,
réintroduction de règles `html.k-mobile-premium-v1`) n'a **pas été appliqué tel quel** :
- 112px aurait **doublé** la hauteur du header (effet inverse de "remonter").
- `html.k-mobile-premium-v1` ne pilote plus aucune règle dans hero.css (nettoyé en amont),
  la classe est toujours posée par `b-mobile-premium-v1.js` mais sans CSS associé à restaurer.
- Le hardcode `(h + 44)` dans `index.html` est resté **inerte** jusqu'ici : `#k-page-scroll`
  n'est `position:fixed`/`relative` qu'en mode `.k-pager-active` (où `top` vient de
  `--pager-top`, posé séparément par `b-pager.js`). Il a quand même été corrigé par cohérence
  (point #4 de la proposition était valable en principe).

## ✅ Vrai levier : `--header-h` (var CSS unique, source de vérité)
`#k-hero-fixed-wrap { top: var(--header-h) }` et `#k-header-spacer { height: var(--header-h) }`
dépendent tous deux de cette variable → la réduire fait remonter **header + search bar +
hero/slogan + tout le contenu de la page** d'un seul coup, sans double compensation.

**Fichier** : `css/tokens.css`
`--header-h: 56px → 44px` (mobile uniquement ; valeur déjà utilisée comme fallback dans
`js/b-store.js:276` et dans le hardcode JS — donc cohérente avec l'historique du projet,
cf. commentaire `layout.css:64` "header 44px → 3px de marge").

**Garde-fous pour que rien ne déborde dans le header réduit** :
- `css/layout.css` `.k-cart-btn` (mobile, après la règle de base 48px) : nouvel override
  `width/height: 40px` — l'avatar 40px le remplit exactement, 0 marge perdue.
- `css/layout.css` `.k-logo-brand` (signature "K + Komerce" empilés) : `margin-top: 12px → 4px`,
  pour conserver un débordement bas comparable à l'existant (~3.5px contre ~5.5px avant)
  dans le header réduit.

## ✅ Fix JS (cohérence, point #4 de la proposition)
**Fichier** : `index.html`, script inline hero sticky.
`scroll.style.top = (h + 44) + 'px'` → remplacé par une lecture de `--header-h` via
`getComputedStyle`, identique au pattern déjà en place dans `js/b-store.js:276`.

## Bilan cumulé du sprint (3 corrections)
- Search bar : 34px → 30px (-4px)
- Slogan `padding-top` : 3px → 0
- Header mobile : 56px → 44px (-12px) → décale header + hero + slogan + page de 12px vers le haut

Bundles régénérés via `node scripts/deploy-css.js` → `base.css` v78→v80, `event.css` v20→v21.
Vérifications statiques (`check:html`, `check:imports`, `check:body-classes`, `audit:arch`,
`check:breakpoints`) : aucune nouvelle régression (les warnings restants sont pré-existants).
