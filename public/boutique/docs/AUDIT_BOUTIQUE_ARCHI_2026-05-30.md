# Komerce Boutique — Audit Architecture Profond

> **Date** : 30 mai 2026 · **Méthode** : analyse statique du code réel (zip `boutique.zip`), pas des claims docs.
> **Objectif** : maîtriser *qui vit où* — quand on touche un paramètre, savoir exactement ce qu'on impacte.
> **Contexte** : pré-mise en prod. Bug récurrent : sur mobile, croix de fermeture + boutons du modal débordent encore malgré les fix VIS-3 (déjà présents dans ce zip).

---

## 0. Verdict en une phrase

La boutique fonctionne, mais le **modal produit est en multipropriété non coordonnée** : **6 fichiers CSS** et **11 modules JS** écrivent dans le même composant, avec **22 breakpoints distincts** là où la règle du projet en impose **un seul** (900px). C'est la cause mécanique des régressions à répétition — chaque correctif est une rustine qui en déclenche une autre.

---

## 1. Tableau de bord — violations comptées

| # | Violation | Mesure réelle | Cible | Sévérité |
|---|-----------|---------------|-------|----------|
| V1 | **Breakpoints anarchiques** | 22 valeurs distinctes (`380, 390, 480, 520, 600, 640, 700, 767, 768, 899, 900, 999, 1000…`) · 57 occurrences non-900 | 1 seul : 900px (+ 1200 toléré) | 🔴 |
| V2 | **Multipropriété CSS du modal** | 6 fichiers stylent `.k-modal*` (modal.css 352, boutique-desktop 20, interactions 9, desktop-skeleton 4, layout 2, cart 1) | 1 owner | 🔴 |
| V3 | **Multipropriété DOM du modal** | 11 modules JS écrivent le DOM modal (core 33, enhancers 44, product 42, hybrid 31…) | ≤ 3 owners explicites | 🔴 |
| V4 | **Doc OWNERSHIP périmée** | dit owner = `b-modal.js` (fichier quasi-vide aujourd'hui) ; réalité = 11 modules | doc = code | 🔴 |
| V5 | **Rustines de position empilées** | `top:-4px`, `bottom:28px car -20px car z-index:2`, `padding-right:10px`… chaînes de compensation | layout structurel | 🟠 |
| V6 | **`!important` (dette spécificité)** | 35 occurrences (group-cart-flow 15, hero-cart-proxy 6, modal 3…) | < 5 | 🟠 |
| V7 | **CSS injecté via JS hors pipeline** | `b-modal-core.js` 52 inject CSS, `b-cart.js` 32, `b-cart-pill.js` 19… | 0 (CSS dans .css) | 🟠 |
| V8 | **modal.css monolithe** | 1916 lignes / 94 Ko dans un seul fichier | < 600 l/fichier | 🟠 |

**Total : 8 familles de violations, dont 4 bloquantes pour la maîtrise.**

---

## 2. Pourquoi le modal mobile déborde ENCORE (diagnostic du bug persistant)

Les fix VIS-3 (padding clamp, `info.appendChild`, `env(...,12px)`) **sont bien dans ce zip** (`modal.css:328,475,543` + `b-modal-product.js:320,348`). Le débordement persiste pour une raison structurelle qu'aucun de ces fix ne traite :

### 2.1 Cause racine — breakpoints qui se chevauchent

`modal.css` déclare, pour la **même** surface mobile :
- `@media (max-width: 600px)` → `.k-modal-img-wrap { height: 40vh }` (l.159)
- `@media (max-width: 480px)` → `.k-modal-img-wrap { height: 50vh }` (l.209)
- règles de base sans media query

Selon la largeur **exacte** du téléphone (un Galaxy 360px, un iPhone 390px, un grand Android 412px), des combinaisons **différentes et contradictoires** s'appliquent. La croix `#k-modal-close` vit dans `.k-modal-topbar-right` avec `padding-right:10px` (rustine "VIS-5"), mais la topbar elle-même n'a **pas** de garantie `max-width:100vw` + `box-sizing` cohérent à tous les breakpoints → sur certaines largeurs, le cercle blanc de la croix passe sous le bord droit de l'écran (visible image 2).

### 2.2 Cause aggravante — chaîne de compensation z-index

```
.k-modal-details { margin-top:-20px; z-index:2 }   ← remonte la carte sur l'image
  → .k-modal-info { padding-top: clamp(20px…) }     ← compense le -20
  → .k-modal-view-full { bottom:28px }              ← "car 28>20 pour sortir du chevauchement"
  → .k-modal-counter, .k-modal-promo-badge…         ← chacun recalé à la main
```

Chaque élément est positionné **par rapport au bug précédent**, pas par rapport à une grille. Ajouter un élément (ex. la trust-bar) casse la chaîne.

### 2.3 Le correctif durable (Sprint 2 ci-dessous)

Ce n'est pas un énième `bottom:Xpx`. C'est :
1. **Un seul breakpoint** (900px) → supprimer 480/600/768 sur le modal.
2. **`box-sizing:border-box` + `max-width:100%`** garantis sur topbar, actions, scroll.
3. **La carte détails ne chevauche plus l'image par margin négative** → utiliser un `border-radius` + `transform` contrôlé, ou un padding de la zone image, pas un `margin-top:-20px`.

---

## 3. CARTOGRAPHIE — qui vit où (le cœur de votre demande)

### 3.1 Carte de propriété DOM du modal (générée depuis le code)

| Module JS | écritures DOM | inject CSS | bus on/emit | Rôle réel observé |
|-----------|:---:|:---:|:---:|---|
| `b-modal-core.js` | 33 | 52 | 2/3 | Cycle open/close, overlay, scroll-lock, carousel, zoom plein écran |
| `b-modal-desktop-enhancers.js` | 44 | 6 | 4/2 | Trust bar, delivery, breadcrumb, flash timer (desktop) |
| `b-modal-product.js` | 42 | 6 | 0/1 | Rendu fiche (prix, images, variants, trust-mobile, delivery-mobile) |
| `b-modal-approche-c-hybrid.js` | 31 | 0 | 2/0 | Réorganise actions/delivery (desktop, gated `isDesktop()`) |
| `b-pdp-curation-suggestions.js` | 14 | 0 | 1/0 | Rail suggestions curées |
| `b-modal-nav.js` | 10 | 9 | 1/4 | Navigation prev/next, retour catalogue, historique |
| `b-modal-social-proof.js` | 9 | 0 | 2/0 | Rendu `.k-modal-meta` (preuve sociale) |
| `b-modal-image-ux.js` | 8 | 5 | 4/0 | Zoom, "voir en grand", swipe |
| `b-mobile-premium-v1.js` | 4 | 2 | 1/0 | Surcouche premium mobile |
| `b-modal-suggestions.js` | 4 | 0 | 2/3 | Rail suggestions + filtre sous-cat |
| `b-modal-cart.js` | 2 | 0 | 0/0 | Stepper qty + ajout panier |

→ **9 modules écrivent réellement le DOM. 4 le font massivement (>30).** Aucun contrat ne dit lequel a la priorité sur `.k-modal-actions` ou la topbar.

### 3.2 Carte de propriété CSS

| Surface | Owner attendu (doc) | Owners réels (code) | Conflit ? |
|---------|--------------------|--------------------|:---:|
| `.k-modal*` | `b-modal.js` (périmé) | modal.css + 5 autres | 🔴 |
| `.k-card`, `.k-grid` | products.css | products + 3 autres | 🔴 |
| `.k-side-cart` | boutique-desktop.css | + cart.css | 🟠 |
| `.k-group-*` | group-cart-flow.css | group-cart-flow seul ✅ | ✅ |

### 3.3 Ordre de chargement (main.js — 15 imports)

```
b-utils → b-bus → b-store → boutique → share-phone-guard →
desktop-upgrade → scroll-owner → product-open-contract →
cart-product-open-style → modal-desktop-enhancers →
modal-approche-c-hybrid → pdp-curation-suggestions →
home-premium-v1 → greeting(importé mais NON appelé ⚠️)
```

**Point d'attention** : `b-greeting` est importé mais jamais invoqué (commentaire "FIX GREETING" dans main.js) — dead import.

---

## 4. SPRINTS de refactorisation

> Règle d'or : **un sprint = un périmètre clos = `npm run check:all` vert**. Pas de big-bang.

### Sprint 0 — Filet de sécurité (prérequis, 0 refacto)
- [ ] **S0.1** Écrire les tests Playwright F1–F5 (ouverture modal, ajout panier, nav prev/next, fermeture+scroll, offline cache). **Sans ça, aucune refacto modal n'est sûre.**
- [ ] **S0.2** Geler la carte de propriété §3 dans `BOUTIQUE_COMPONENT_OWNERSHIP.md` (remplacer la version périmée).
- [ ] **S0.3** Ajouter au precommit un guard : "aucun nouveau breakpoint hors 900/1200" (`scripts/check-breakpoints.js`).

### Sprint 1 — Unifier les breakpoints 🔴 (résout V1)
- [ ] **S1.1** Recenser les 57 media queries non-900. Pour chacune : la remonter en base (mobile-first) ou la passer sous 900px.
- [ ] **S1.2** Supprimer `@media (max-width:480px)` et `(max-width:600px)` du modal → fusionner en base mobile.
- [ ] **S1.3** Rebundler, tester sur 360 / 390 / 412 / 768px.
- **Impact** : c'est CE sprint qui règle le débordement mobile durablement.

### Sprint 2 — Délinéariser le positionnement modal 🔴 (résout V5 + bug croix)
- [ ] **S2.1** Remplacer `.k-modal-details { margin-top:-20px }` par un overlap contrôlé (la zone image porte le rayon, pas la carte qui remonte).
- [ ] **S2.2** Garantir `box-sizing:border-box` + `max-width:100%` sur `.k-modal-topbar`, `.k-modal-topbar-right`, `.k-modal-actions`, `.k-modal-scroll`.
- [ ] **S2.3** Supprimer les rustines `top:-4px`, `padding-right:10px` "VIS-5" devenues inutiles après S2.2.
- [ ] **S2.4** Retester croix + badge + boutons sur petit écran.

### Sprint 3 — Owner unique CSS modal 🔴 (résout V2)
- [ ] **S3.1** Rapatrier les `.k-modal*` de `interactions.css`, `desktop-commerce-skeleton.css`, `layout.css`, `cart.css` vers `modal.css` (ou un découpage clair, cf. S5).
- [ ] **S3.2** Laisser `boutique-desktop.css` posséder UNIQUEMENT le side-cart desktop, pas le modal.
- [ ] **S3.3** Mettre à jour `OWNERSHIP.md`.

### Sprint 4 — Contrat DOM modal 🔴 (résout V3 + V4)
- [ ] **S4.1** Définir 3 owners DOM explicites : `core` (shell/cycle), `product` (contenu fiche), `nav` (navigation). Tout le reste émet via le bus, ne touche pas le DOM directement.
- [ ] **S4.2** `enhancers` et `hybrid` : passer leurs mutations DOM par des hooks exposés par `core`/`product`, pas par `querySelector` + `appendChild` sauvage.
- [ ] **S4.3** Supprimer le dead import `b-greeting` (ou le câbler si voulu).

### Sprint 5 — Découper modal.css (résout V8)
- [ ] **S5.1** `modal.css` (1916 l) → `modal-shell.css` (overlay, topbar, scroll, actions), `modal-product.css` (fiche, prix, variants), `modal-media.css` (carousel, zoom, dots). Bundle inchangé côté HTTP.

### Sprint 6 — Nettoyer la dette (V6 + V7)
- [ ] **S6.1** Réduire les 35 `!important` (commencer par group-cart-flow:15).
- [ ] **S6.2** Sortir le CSS injecté par `b-modal-core.js` (52) et `b-cart.js` (32) vers les .css.

---

## 5. Le doc proposé (`AUDIT_REFACTORISATION_BOUTIQUE.md`) est-il pertinent ?

**Partiellement — à actualiser.**

| Élément du doc | Statut réel | Verdict |
|----------------|-------------|---------|
| ARCH-2 "découper b-modal.js (2228 l)" | `b-modal.js` **déjà éclaté** (quasi-vide) | ⚠️ Périmé — remplacer par S3/S4/S5 |
| ARCH-7 "Playwright F1–F5" | toujours absent | ✅ Pertinent = mon Sprint 0 |
| ARCH-3 "bundler JS" | toujours valable | ✅ Pertinent (basse priorité pré-prod) |
| Sprints 1–2 "historique des fix" | cohérent | ✅ Garder comme journal |
| "Décisions figées" | cohérentes | ✅ Garder |

→ **Garder** : la structure (tableau de bord + journal + décisions figées), ARCH-3, ARCH-7, les décisions figées.
→ **Remplacer** : ARCH-2 (obsolète) par les Sprints 1→5 de ce document, qui attaquent la **vraie** cause (breakpoints + multipropriété), pas un découpage de fichier qui a déjà eu lieu.

---

## 6. Ordre d'exécution recommandé

```
Sprint 0 (filet)  →  Sprint 1 (breakpoints)  →  Sprint 2 (positionnement)
                          ↓                            ↓
                   [bug mobile résolu ici]    [croix/boutons résolus ici]
                          ↓
Sprint 3 (owner CSS) → Sprint 4 (contrat DOM) → Sprint 5 (découpe) → Sprint 6 (dette)
```

Les **Sprints 1 et 2 suffisent à régler le bug visible** que vous signalez. Les Sprints 3→6 sont ce qui vous donne la **maîtrise durable** ("quand je touche, je sais quoi j'impacte").

---

## 7. Règle de mise à jour de ce document

À chaque PR : cocher la case du sprint concerné, ajouter une ligne au journal (date + PR + violation fermée), et si une propriété change, **mettre à jour `BOUTIQUE_COMPONENT_OWNERSHIP.md` dans la même PR** (sinon la doc redevient périmée — c'est ce qui a créé V4).

| Date | Sprint | PR | Violation fermée |
|------|--------|----|--------------------|
| 2026-05-30 | — | — | Création audit. 8 familles de violations recensées, cartographie modal figée. |
