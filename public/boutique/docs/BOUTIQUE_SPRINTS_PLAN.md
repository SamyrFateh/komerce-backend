# Boutique — Plan de sprints réordonné (pour exécution Sonnet)

> Basé sur `docs/BOUTIQUE_OWNERSHIP_LIVE.md` (carte générée depuis le code réel, 30/05/2026).
> Réordonné selon l'impact réel mesuré, pas selon l'intuition.
> **Règle absolue** : 1 sprint = 1 périmètre = `npm run check:all` vert avant merge. Jamais de big-bang.

---

## Ce que la carte a changé dans la priorisation

L'audit initial visait le modal en premier. La carte de propriété révèle deux choses que l'intuition ratait :

1. **`b-checkout.js` (116 écritures DOM) et `b-cart.js` (58 DOM + 37 CSS, touche 7 composants)** sont les modules les plus dangereux — bien avant le modal. Toute régression panier/checkout est invisible et critique (c'est de l'argent).
2. **Le bug mobile visible (croix/boutons) = breakpoints**, pas le DOM. Donc Sprint breakpoints AVANT sprint DOM.

D'où l'ordre ci-dessous.

---

## SPRINT 0 — Filet de sécurité (PRÉREQUIS ABSOLU)

> Sans ça, aucun sprint suivant n'est sûr. Les modules à 100+ écritures DOM ne se refactorent pas à l'aveugle.

- [ ] **S0.1** — Tests Playwright des 5 flows critiques (`test:e2e` existe déjà, l'étoffer) :
  - F1 ouverture modal depuis grille (mobile + desktop)
  - F2 ajout panier depuis modal → vérifier badge + side-cart
  - F3 checkout complet (le module à 116 écritures — le plus risqué)
  - F4 fermeture modal + position scroll catalogue préservée
  - F5 panier partagé : créer, partager, payer
- [ ] **S0.2** — Figer la baseline breakpoints : `npm run check:breakpoints:save` (déjà à 35).
- [ ] **S0.3** — Vérifier que `npm run audit:ownership` tourne au precommit (déjà câblé dans check:all).

**Sortie attendue** : `npm run test:e2e` vert sur les 5 flows. C'est le filet.

---

## SPRINT 1 — Breakpoints du modal 🔴 (RÉSOUT LE BUG MOBILE VISIBLE)

> Cible la cause du débordement croix/boutons. Ne touche QUE modal.css. Petit, sûr, visible.

- [ ] **S1.1** — Dans `modal.css`, supprimer `@media (max-width: 480px)` (l.209) et `@media (max-width: 600px)` (l.159) : fusionner leurs règles en base mobile (mobile-first).
- [ ] **S1.2** — Remplacer les `@media (max-width: 899px)` par des règles de base (le mobile EST la base ; desktop = `min-width:900px`).
- [ ] **S1.3** — Supprimer le `@media (max-width: 768px)` du modal (chevauche 899).
- [ ] **S1.4** — `npm run bundle:css` puis tester sur 360 / 390 / 412 / 768px.
- [ ] **S1.5** — `npm run check:breakpoints:save` pour figer le gain (modal.css doit sortir de la liste).

**Sortie attendue** : modal.css n'a plus que 900px + 1200px. Croix et boutons cessent de déborder.

---

## SPRINT 2 — Délinéariser le positionnement modal 🔴 (VERROUILLE LE FIX)

> Supprime la chaîne de compensation `margin-top:-20px → padding → bottom:28px`.

- [ ] **S2.1** — `box-sizing: border-box` + `max-width: 100%` garantis sur `.k-modal-topbar`, `.k-modal-topbar-right`, `.k-modal-actions`, `.k-modal-scroll`.
- [ ] **S2.2** — Remplacer `.k-modal-details { margin-top:-20px }` : faire porter le chevauchement par un `border-radius` haut sur `.k-modal-details` + un `margin-top` positif nul, l'image gardant sa hauteur. Plus de remontée par marge négative.
- [ ] **S2.3** — Une fois S2.2 fait, retirer les rustines devenues inutiles : `.k-modal-close { top:-4px }`, `.k-modal-topbar-right { padding-right:10px }` "VIS-5", `.k-modal-view-full { bottom:28px }` → revenir à des valeurs nominales.
- [ ] **S2.4** — Tester sur petit écran : croix, badge panier, "Voir en grand", titre, description, boutons.

**Sortie attendue** : positionnement structurel, plus aucune valeur magique "car X compense Y".

---

## SPRINT 3 — Sécuriser b-cart.js + b-checkout.js 🔴 (LES PLUS RISQUÉS)

> 116 + 58 écritures DOM. C'est là que se cachent les régressions panier/argent. Filet S0 obligatoire avant.

- [ ] **S3.1** — `b-checkout.js` : extraire le rendu DOM (116 écritures) dans des fonctions pures testables. Ne pas changer la logique, juste isoler le DOM du métier.
- [ ] **S3.2** — `b-cart.js` : il touche 7 composants (modal, side-cart, panier, carte, header, chips, bnav). Identifier lesquels sont légitimes et lesquels devraient passer par le bus. Sortir les 37 injections CSS vers `cart.css`.
- [ ] **S3.3** — Après chaque extraction, `npm run test:e2e` (flows F2, F3, F5).

**Sortie attendue** : DOM séparé du métier, CSS hors du JS, flows panier verts.

---

## SPRINT 4 — Owner unique CSS par composant 🔴 (RÉSOUT LA MULTIPROPRIÉTÉ)

> Attaquer dans l'ordre du risque décroissant vu sur la carte.

- [x] **S4.1 — Header** (5 fichiers → layout.css) ✅ `30/05/2026`
  - `k-header*` rapatrié dans `layout.css` depuis hero-cart-proxy (11), boutique-desktop (9), desktop-skeleton (7)
  - `hero-cart-proxy.css` réduit aux seules règles `k-hero-bubble`
  - Owners : 5 → 3 (hero.css = commentaire, tokens.css = variable `--header-h`, non déplaçables)
- [x] **S4.2 — Chips** (4 fichiers → categories.css) ✅ `30/05/2026`
  - Section CARTES VISUELLES + fonds subchip migrés depuis `boutique-desktop.css`
  - Animation `k-chip-pulse` + `.k-chip.transitioning` migrés depuis `interactions.css`
  - Owners : 4 → 3 (layout.css = 2 commentaires-redirects, interactions.css = 1 ref `prefers-reduced-motion`)
- [x] **S4.3 — Carte produit** (4 fichiers → products.css) ✅ `30/05/2026`
  - CARD HOVER + ANIMATION ENTRÉE CARTES migrés depuis `boutique-desktop.css`
  - `.k-card` glass-effect PALETTE-FIX-01 migré depuis `desktop-commerce-skeleton.css`
  - 4 sélecteurs restants dans boutique-desktop = utilitaires focus/tap-highlight cross-composant (légitimes)
- [x] **S4.4 — Grille** (4 → 2) ✅ `30/05/2026`
  - `k-grid-has-sections` (base + `@media 899px`) migré depuis `interactions.css`
  - `@keyframes k-grid-out/in-*` + classes `.k-grid.k-grid-slide-*` migrés depuis `interactions.css`
  - `prefers-reduced-motion` grille migré (chip resté dans `interactions.css`)
  - Owners grille : 4 → 2 (`layout.css` = overflow-x structural légitime, `cart.css` = flat-subcat panier légitime)
- [x] **S4.5 — Modal** (4 → 1) ✅ `30/05/2026`
  - `.k-modal-scroll`, `.k-modal-back-top`, `.k-modal-topbar-*` migrés depuis `interactions.css`
  - Modal zoom carousel + Recently Viewed + Keyboard hint migrés depuis `boutique-desktop.css`
  - `.k-modal` (max-width, border-radius, box-shadow) + `.k-modal-img-wrap` migrés depuis `desktop-commerce-skeleton.css`
  - `.k-modal` tap-highlight + focus-visible séparé de `.k-card` dans section §11 `boutique-desktop.css`
  - Owner unique : `modal.css`
- [x] **S4.6** — Ownership régénéré après chaque sous-étape. ✅ `30/05/2026`

**Sortie attendue** : score "Composants en multipropriété CSS" passe de 8 → 0.

---

## SPRINT 5 — Contrat DOM (réduit les 39 modules) 🔴

- [ ] **S5.1** — Définir 3 owners DOM du modal : `core` (shell), `product` (contenu), `nav` (navigation). Documenter dans `BOUTIQUE_COMPONENT_OWNERSHIP.md`.
- [ ] **S5.2** — `enhancers`, `hybrid`, `image-ux`, `social-proof`, `suggestions` : exposer des hooks depuis core/product au lieu de `querySelector + appendChild` direct.
- [ ] **S5.3** — Supprimer le dead import `b-greeting` dans main.js (importé, jamais appelé).

**Sortie attendue** : score "Modules JS écrivant le DOM" baisse nettement.

---

## SPRINT 6 — Dette finale (V6 + reste)

- [ ] **S6.1** — Réduire les 35 `!important`, en commençant par `group-cart-flow.css` (15).
- [ ] **S6.2** — Découper `modal.css` (1916 l) en `modal-shell` / `modal-product` / `modal-media` (bundle HTTP inchangé).
- [ ] **S6.3** — Breakpoints des fichiers restants (group-cart-flow a 7 violations, cart.css 4…) → tout ramener à 900/1200.

**Sortie attendue** : tous les indicateurs du score de contrôle au vert.

---

## Tableau de progression (régénéré par `npm run audit:ownership`)

| Indicateur | Départ (30/05) | Après S4.1-4.3 | Après S4 | Cible |
|------------|:---:|:---:|:---:|:---:|
| Multipropriété CSS | 8 | 8 | 8* | 0 |
| Modules JS DOM | 39 | 39 | 39 | ≤ 5 |
| Breakpoints distincts | 20 | ~18 | ~18 | ≤ 2 |
| Violations breakpoint | 35 | ~32 | 31 | 0 |
| `!important` | 35 | 35 | 35 | < 5 |

> \* Les 8 composants restent en multipropriété sur la carte — les owners `layout.css` (overflow structural) et `cart.css` (flat-subcat) sont **légitimes** et non déplaçables. La carte reflète la réalité : modal.css est devenu owner unique du modal, products.css owner principal de la grille.

> Après chaque sprint : `npm run audit:ownership` met à jour `BOUTIQUE_OWNERSHIP_LIVE.md`. Reporter les chiffres ici. La carte ne ment pas — c'est votre preuve de progrès.

---

## Règle pour Sonnet à chaque PR

1. Travailler UN sprint à la fois (ou une sous-étape S4.x).
2. `npm run check:all` doit être vert avant de proposer le merge.
3. Régénérer `npm run audit:ownership` et committer la carte mise à jour.
4. Si une propriété change, mettre à jour `BOUTIQUE_COMPONENT_OWNERSHIP.md` dans la MÊME PR.
5. Ne jamais introduire un breakpoint hors 900/1200 (le precommit `check:breakpoints` bloquera sinon).
