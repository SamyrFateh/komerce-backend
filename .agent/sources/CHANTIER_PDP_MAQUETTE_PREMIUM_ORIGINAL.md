# Chantier — PDP Komerce conforme maquette premium

> **Statut** : ouvert, une seule ouverture, exécution autonome par Sonnet
> **Livrable attendu** : la PDP mobile et desktop rend la maquette validée
> **Date d'ouverture** : à compléter par Sonnet au démarrage
> **Doctrine amont obligatoire** : `AGENTS.md`, `docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md`, `docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md`, `public/boutique/features/modal-product.feature.js`
> **Ne pas rouvrir** : les décisions produit ci-dessous sont tranchées

> **Entrée** : dépôt monokomerce complet, sur la branche cible. Sonnet travaille dans le checkout, jamais dans un zip différentiel.
> **Références externes en lecture seule** : maquette (`maquette-source-mobile-desktop.png`), specs de vérité (`02_SPECS_SOURCE_DE_VERITE/pdp-mobile-spec.md`, `pdp-desktop-spec.md`), rapport du 18 juillet à ne pas régresser (`04_VALIDATION_ET_PREUVES/RAPPORT_VALIDATION_CORRECTIF_FINAL.md`) — à conserver à côté du checkout comme référence normative et cible visuelle.

---

## 1. Plan d'attaque (format AGENTS.md §1)

### Demande comprise

Aligner le rendu visuel de la PDP mobile et desktop sur la maquette premium validée (`03_MAQUETTE_ET_CAPTURES/maquette-source-mobile-desktop.png`), sans toucher à l'architecture, au state machine SKU, à la logique panier multi-variantes, aux composants métiers ni aux contrats. Le rendu actuel diverge de la maquette sur trois axes : palette (coral/ocean introduits hors charte), typographie (graisses 600 à 900 au lieu de 400/500), et densité (enrichissements desktop non spécifiés + blocs mobile absents).

### Feature / transversal

- Feature backend/frontend concernée : `catalog` (`features/catalog.feature.js`)
- Feature boutique locale : `modal-product` (`public/boutique/features/modal-product.feature.js`)
- Domaine : `catalog`
- Slice : `frontend-slice`

### Opération

**Update** sur les fichiers de rendu et de composition de la PDP. Aucun `Create` de nouveau module, aucun `Delete` de composant métier. Retraits ciblés dans `index.html` (bouton favori) et désactivations propres dans deux modules explicitement documentés comme éditoriaux ou expérimentaux.

### Cartes à lire (dans l'ordre)

1. `AGENTS.md`
2. `docs/CARTE_FIRST_INDEX.md`
3. `features/catalog.feature.js`
4. `public/boutique/features/modal-product.feature.js`
5. `docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md`
6. `docs/boutique/BOUTIQUE_ARCHITECTURE.md`
7. `docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md`
8. `docs/boutique/BOUTIQUE_COMPONENT_OWNERSHIP.md`
9. `docs/boutique/BOUTIQUE_CSS_PIPELINE.md`
10. `docs/BOUTIQUE_360.md` (graphe généré, pour la topologie bus)
11. Spécifications de vérité : `02_SPECS_SOURCE_DE_VERITE/pdp-mobile-spec.md` et `pdp-desktop-spec.md` du livrable

### Périmètre probable

**CSS sources — édition directe autorisée :**
- `public/boutique/css/tokens.css` — pour ajouter des tokens si nécessaire (aucun `rgba(...)` littéral admis, cf. `modal-product.feature.js` doctrine.max = 0)
- `public/boutique/css/modal-shell.css` — shell, topbar, scroll, actions (mobile + desktop)
- `public/boutique/css/modal-media.css` — hero, carousel, miniatures, favori (à retirer)
- `public/boutique/css/modal-product.css` — infos produit, prix, variantes, livraison, actions produit (**owner primaire de la fiche produit — ce fichier n'était PAS dans le zip livraison différentiel mais est bien la source de vérité**)
- `public/boutique/css/modal-product-lot4-hybrid.css` — extension PDP hybride desktop
- `public/boutique/css/modal-mobile-canonical.css` — canoniques mobile (à explorer, ownership à confirmer)
- `public/boutique/css/modal-enriched-content.css` — contenu enrichi (à explorer, ownership à confirmer)

**JS sources — modifications ciblées uniquement :**
- `public/boutique/js/b-modal-desktop-enhancers.js` — désactivation propre des injections `injectBreadcrumb`, `injectTrustBadges`, `injectShareRow`, `injectRecentlyViewed` sur PDP
- `public/boutique/js/b-modal-approche-c-hybrid.js` — module `ui-experiment`, désactivation clean sur PDP
- `public/boutique/js/b-modal-desktop-product.js` — repositionner `renderPaymentSection` hors panneau commercial (sous les suggestions, spec §11), ou conditionner sa présence
- `public/boutique/js/b-modal-mobile-product.js` — à lire d'abord pour comprendre le rendu Couleur/Taille (peut-être aucune modification requise, cf. §5.1 « Vérification préalable mobile »)
- `public/boutique/js/b-modal-buybox-shared.js` — icônes bag + bolt dans les CTA mobile si absentes du rendu
- `public/boutique/js/b-modal-image-ux.js` OU renderer approprié — branchement de la sous-ligne série sur `product.series` avec fallback silencieux

**HTML source — édition ciblée :**
- `public/boutique/index.html` — retrait du nœud `.k-modal-fav-btn` du DOM initial de la modal PDP

**Tests — complétion au contact :**
- `public/boutique/tests/unit/b-modal-desktop-enhancers.test.js`
- `public/boutique/tests/unit/b-modal-approche-c-hybrid.test.js`
- `public/boutique/tests/unit/b-modal-desktop-product.test.js`
- `public/boutique/tests/unit/b-modal-mobile-product.test.js` (si M2/M3 exige modification renderer)
- `public/boutique/tests/unit/b-modal-buybox-shared.test.js` (si icônes CTA ajoutées)

Tout fichier touché doit avoir sa couverture ramenée à 100 % (AGENTS.md §7 complétion au contact).

### Hors périmètre

- Architecture globale de la modal, orchestration, cycle ouverture/fermeture (`b-modal-core.js`, `b-modal-product-detail-bootstrap.js`)
- State machine SKU (`view-models/modal-selection-model.js`), contrat détail v1, endpoints
- Logique panier (`b-cart.js`, `cart-line-identity.js`, `view-models/modal-cart-state.js`), `line_id` canonique — tout ce qui a été validé par `RAPPORT_VALIDATION_CORRECTIF_FINAL.md`
- `b-modal-social-proof.js` — mort en pratique (écouteur orphelin de `modal:product-changed`, personne n'émet), donc la meta-row Bestseller/rank/étoiles ne se rend pas au runtime, aucune correction visuelle nécessaire (dette architecturale à traiter séparément)
- `modal-view-model.js` legacy (compatibilité PDC-6)
- Grille et cartes catalogue, hero mobile, catégories, panier partagé
- Toute modification qui créerait une seconde source de vérité de prix, stock, livraison, sous-total
- Ajout de nouveaux endpoints ou modification de contrats

### Invariants à protéger

De `catalog.feature.js` et `modal-product.feature.js` :

- Un seul Product Detail Contract chargé par ouverture produit, partagé mobile/desktop
- Un seul état de sélection produit partagé mobile/desktop
- `b-modal-desktop-enhancers` ne calcule ni prix, ni stock, ni livraison, ni sous-total
- `b-modal-approche-c-hybrid` ne rend ni livraison, ni sous-total, ni paiement produit
- Le product-zone desktop reste en `display: grid` avec `grid-template-columns` (gate `render-static` positif dans `modal-product.feature.js`)
- L'image mobile ne peut pas s'écraser dans le flex scroll (`min-height: 260px`, `flex: 0 0 auto`)
- Le bouton « Voir en grand » reste ancré à l'image (`bottom: 12px`, `left: 10px`, `position: absolute`)
- `k-modal-img-wrap` reste `position: relative`
- Suggestions modal émettent `modal:suggestions-rendered`, PDP curation écoute cet événement
- Zéro `rgba(...)` littéral dans le scope modal-product (`doctrine.max = 0`)
- Mobile et desktop utilisent la même logique de sous-total (`b-modal-buybox-shared.js / computeSubtotal`)
- Mobile et desktop exposent les mêmes modes de paiement via `b-modal-buybox-shared.js / renderPaymentModes` — composition différente, logique unique

Ces invariants sont vérifiés par les gates `render-static`, `doctrine`, `boundary`, `feature-audit`, `boutique:360:check`. Toute violation bloque le pre-commit.

### Risques / points à vérifier

- **Cliquet 360 bus** : état actuel 1 émission orpheline (`sidebar:built`) + 1 écouteur orphelin (`modal:product-changed`) + 7 événements non déclarés. Ne pas aggraver. Les corrections de ce chantier ne touchent pas au bus.
- **Cliquet doctrine tokens** : `modal-product.feature.js` doctrine.max = 0 → tout `rgba(...)` littéral introduit fait échouer le gate. Toute couleur nouvelle passe par un token dans `tokens.css`.
- **Ownership CSS partagé** : plusieurs sélecteurs (topbar rappelée au scroll, side-cart, badge cart) touchent le scope modal mais servent aussi d'autres surfaces. Toute normalisation typo/couleur doit être scopée `#k-modal` avec précision — jamais un `#k-modal *`.
- **Fichiers CSS PDP absents du zip livraison** : `modal-product.css`, `modal-mobile-canonical.css`, `modal-enriched-content.css` existent dans le repo mais n'étaient pas dans le zip différentiel. Sonnet doit les lire avant tout diagnostic.
- **Modules mobile orphelins** : `b-mobile-modal-v1.js` et `b-mobile-premium-v1.js` écoutent `modal:opened` avec `usedBy: []` selon le graphe 360. Vérifier dans `index.html` s'ils sont chargés en `<script>` tag (side-effect) : c'est le coupable probable de M2/M3.
- **Régénération dist obligatoire** : toute modification source impose `npm run deploy:css` + `npm run check:cache` + commit des dist et du cache-buster.
- **Pipeline de bundling** : bundle official = `public/boutique/scripts/deploy-css.js`. Ne pas utiliser d'ancien bundler.
- **Complétion au contact** : AGENTS.md §7 — si fichier ET son test dans la même PR, couverture 100 %.
- **Zéro régression sur PDP-1/PDP-2** : le correctif `RAPPORT_VALIDATION_CORRECTIF_FINAL.md` du 18 juillet doit rester intégralement valide (`renderPdpActions` partagé, `line_id` canonique, `data-line-id` sécurisé, tests Playwright verts).

### Gates et tests prévus

**Après chaque passe :**
```bash
cd public/boutique
npm run deploy:css
npm run check:cache
npm run check:breakpoints
npm run check:html
npm run check:imports
npm run audit:arch
npm run audit:ownership
npm run audit:gate

cd ../..
npm run feature:registry
npm run gate:schema
npm run gate:touched-files
npm run gate:docs-lint
npm run gate:feature-audit
npm run gate:boutique-ownership
npm run audit:features
npm run map:check
```

**Après la Passe 3 (complète) :**
```bash
cd public/boutique
npm run check:all
npm run test:unit

cd ../..
npm run test:unit
```

**Tests Playwright ciblés à passer :**
- `tests/unit/pdp-renderer-action-wiring.test.js` (existant, non-régression state machine)
- `tests/unit/modal-mobile-desktop-parity.test.js`
- `tests/unit/modal-product-price-normalization.test.js`
- Tests spécifiques des modules touchés (cf. Complétion au contact)

---

## 2. Décisions produit tranchées

Ces cinq décisions sont **définitives pour ce chantier**. Ne pas les rouvrir. Si une contradiction apparaît en cours d'exécution, Sonnet documente la contradiction dans un commentaire de code, applique la décision ci-dessous, et signale à l'utilisateur en fin de passe.

### D-P1 — Blocs desktop non spécifiés

**Enrichissements éditoriaux (breadcrumb, trust badges, share row, recemment-vus)** : hors PDP définitif. Désactivés à la racine dans `b-modal-desktop-enhancers.js`. La doctrine `BOUTIQUE_MODAL_ARCHITECTURE.md §8` continue à mentionner « navigation / partage / trust / récemment vus dessous » — cette phrase est mise à jour pour refléter la nouvelle intention : ces enrichissements sont conservés dans le code mais non actifs sur la PDP catalogue vivante. Ils restent disponibles pour une réactivation future via un flag applicatif, sans être exposés visuellement aujourd'hui.

**Payment tabs (Carte / Cash / Panier partagé / Cagnotte) + placement inline des actions Approche-C** : `b-modal-approche-c-hybrid.js` est `layer=ui-experiment`. Désactivation clean par sa nature : ne plus l'importer dans `main.js` sur PDP (garder l'import pour les surfaces où l'expérimentation reste active si elles existent, sinon supprimer l'import). Aucune modification de `b-modal-buybox-shared.js/renderPaymentModes` qui reste la logique unique partagée, seulement son point d'appel PDP est retiré.

**Delivery + subtotal desktop** : conservés dans le code (portent une info transactionnelle réelle et respectent la spec §11 « contenu enrichi sous les suggestions »). **Déplacés sous les suggestions**, hors panneau commercial. `renderPaymentSection` de `b-modal-desktop-product.js` cible désormais un conteneur sous les suggestions, pas dans le panneau commercial. Le sous-total `k-modal-subtotal` : masqué du sticky footer PDP (l'info prix × qty est déjà donnée par le prix + le stepper).

### D-P2 — Bouton favori cœur

`.k-modal-fav-btn` retiré du DOM initial de la modal PDP dans `index.html`. Aucune classe body ni flag conservé. Si un jour Komerce introduit la fonctionnalité favoris sur PDP, elle sera réintroduite par un chantier dédié avec une doctrine explicite. Les styles CSS de `.k-modal-fav-btn` dans `modal-media.css` sont conservés (le composant peut être utilisé ailleurs) mais deviennent orphelins sur PDP — c'est acceptable.

### D-P3 — Prix promo mobile

Le coral sur le prix reste autorisé **uniquement en état promo active** (`.k-modal--has-promo`). Comportement documenté dans `modal-product.css`, sélecteur unique, single source of truth. Toutes les autres occurrences de coral sur du prix (hors promo, topbar rappelée au scroll, badge sous-total, etc.) sont purgées. Le coral hors prix reste autorisé uniquement sur : badge de promo dédié (`k-modal-promo-badge`), rien d'autre.

### D-P4 — Chantier et commits

**Une seule PR** = un seul chantier ouvert. Trois commits internes lisibles, un par passe :

- Commit 1 : `feat(pdp): passe 1 — conformité stricte maquette (palette, typographie, prix, CTA, blocs mobile, désactivation enrichissements desktop)`
- Commit 2 : `feat(pdp): passe 2 — responsive et états produit (grille, fonds, icônes CTA, stepper, meta hero, suggestions)`
- Commit 3 : `feat(pdp): passe 3 — finition premium (purge micro-interactions, ombres, radius, transitions)`

Chaque commit doit être **atomique et vert** : gates verts avant de passer au suivant.

### D-P5 — Autonomie Sonnet

Sonnet exécute toutes les commandes de gate, interprète les résultats, corrige les faux positifs qu'il identifie comme tels, et boucle jusqu'à ce que tout soit vert. Il appelle l'utilisateur **uniquement** dans ces cas :

- **Contradiction de doctrine** : deux docs de gouvernance actives contredisent la maquette, arbitrage requis
- **Régression Playwright ambiguë** : un test échoue et Sonnet ne peut pas déterminer si c'est une régression réelle ou une correction voulue par le chantier
- **Ownership indéterminé** : un sélecteur ou un comportement n'a pas d'owner clair et l'attribuer relève d'une décision produit
- **Décision produit non couverte par ce document** : une question qui n'est ni dans les décisions D-P1 à D-P5 ni dans les vérifications préalables §5

Dans les autres cas, Sonnet travaille en boucle : modification → gate → correction → gate vert → passe suivante. En fin de chantier, il livre un rapport de synthèse.

---

## 3. Passes d'exécution

### Passe 1 — Conformité stricte maquette

**Objectif** : toute la palette, la typographie, les blocs commerciaux de la maquette sont respectés. Les enrichissements desktop non spécifiés sont désactivés à la racine. Les blocs mobile absents (Couleur, Taille, pill stock, carrousel suggestions, icônes CTA, référence) sont rendus.

**Sous-tâches ordonnées :**

1. Lire tous les fichiers du périmètre CSS et JS (voir §1 « Périmètre probable »).
2. **Vérification préalable mobile** — cf. §5.1 : déterminer si M2/M3 est un bug renderer ou un artefact des modules orphelins `b-mobile-modal-v1.js` / `b-mobile-premium-v1.js`. Traiter selon le cas.
3. **Palette et tokens** — passe systématique :
   - Titre h2 desktop → 18 px / 500 / line-height 1.2 / letter-spacing 0 (une seule source de vérité)
   - Prix desktop → 28 px / 500 / `--text-primary` (une seule source de vérité)
   - Prix mobile → 24 px / 500 / `--text-primary` (base + normalisation, sauf `.k-modal--has-promo` qui garde coral)
   - Unité devise → 12 px mobile / 13 px desktop / 500 / `--text-secondary` / pas de `text-transform: uppercase`
   - Toutes les graisses `600, 700, 800, 850, 900` dans le scope `#k-modal` PDP → ramenées à 500 (sauf `--has-promo` promo active si D-P3 exige 700)
   - Suppression de tout `color: var(--coral)` sur prix (hors `--has-promo`), badge panier header, CTA hover, focus input, hover carte suggestion, bordure notify, price topbar rappel — remplacements documentés au §4
   - CTA « Acheter maintenant » mobile + desktop → `background: var(--success)` en aplat, pas de gradient, box-shadow douce, source unique
   - CTA « Me prévenir » (rupture stock) → fond blanc, bordure `--text-primary`, texte `--text-primary`
   - Badge panier header → fond `--success`, border `1.5px solid var(--page-bg)`
   - Suppression des gradients radiaux/linéaires sur `k-modal-product-zone`, `k-modal-img-wrap`, `k-modal-details`, `k-modal-suggestions:not(--desktop-list)` — aplat `--page-bg` ou `--hero-bg` selon la zone
   - Fond scroll mobile continu `--page-bg`, seul le sticky footer reste `--sticky-bg` (blanc)
4. **Rendus mobile absents ou non conformes :**
   - Pill de stock à droite du prix (`5.5` de la spec mobile) — création du markup si nécessaire, styles conformes
   - Bloc Couleur + vignettes (`5.4` spec) — vérification renderer d'abord, création si nécessaire
   - Bloc Taille + chips (`5.6` spec) — idem
   - Référence produit sous le titre (`5.3` spec)
   - Carrousel de suggestions horizontal teasé (`5.7` spec)
   - Icônes `ti-shopping-bag` (bag) et `ti-bolt` (bolt) dans les CTA sticky footer mobile (`5.8` spec)
   - Stepper radius 8 px, background `--hero-bg`, layout conforme (`5.8` spec)
5. **Blocs desktop non spécifiés — désactivation propre :**
   - `b-modal-desktop-enhancers.js` : neutralisation de `injectBreadcrumb`, `injectTrustBadges`, `injectShareRow`, `injectRecentlyViewed` sur PDP (les fonctions restent, elles ne sont plus appelées depuis `onModalOpened`)
   - `b-modal-approche-c-hybrid.js` : retrait de l'import dans `main.js` sur PDP (module `ui-experiment`)
   - `renderPaymentSection` de `b-modal-desktop-product.js` : cible désormais un conteneur sous les suggestions (spec §11), plus dans le panneau commercial
   - `k-modal-subtotal` : masqué du sticky footer PDP (l'info est redondante avec prix × stepper)
   - `k-modal-flash-bar` : vérifier ce qui l'alimente, désactiver
6. **Retraits DOM initial :**
   - `.k-modal-fav-btn` retiré d'`index.html` (D-P2)
7. Régénération dist + cache-buster (`npm run deploy:css` + `check:cache`).
8. **Gates Passe 1** — toute la liste §1 « Gates et tests prévus ».
9. Capture de contrôle sur 4 viewports (360 px, 430 px, 1024 px, 1440 px) — comparaison visuelle vs maquette. Si écart majeur, itération avant Commit 1.
10. Commit 1.

**Critère de sortie Passe 1** : les captures sont **structurellement identiques à la maquette** — même palette, même hiérarchie, mêmes blocs présents, mêmes proportions générales. Tous les gates verts.

### Passe 2 — Cohérence responsive et états produit

**Objectif** : les six viewports (360, 390, 430, 1024, 1440, large) rendent la maquette sans layout shift, sans débordement, avec les six états produit corrects.

**Sous-tâches ordonnées :**

1. **Grille desktop** : `grid-template-columns: 60px minmax(420px, 1fr) 310px; gap: 18px; padding: 18px` à 1024-1439 ; `64px minmax(480px, 1fr) 340px; gap: 22px; padding: 22px` ≥ 1440. Source unique dans `modal-product-lot4-hybrid.css`. Vérifier que le gate `render-static` de `modal-product.feature.js` (display: grid + grid-template-columns) reste vert.
2. **Rail miniatures** : 60 × 60 px, active border `1.5px --text-primary` sans halo, hover sans translate ni glow.
3. **Hero desktop** : aplat `--hero-bg` (retrait de tous les gradients), décors circles `--hero-decor-sand` conformes, ratio 4:3, min-height 360, max-height 500.
4. **Suggestions desktop** : `background: var(--page-bg)`, `border-top: 1px dashed var(--border-strong)`, padding conforme spec §10, titre 15 / 500, grille 4 colonnes 1024+, 5 colonnes large.
5. **Meta hero ligne 2** : branchement `product.series` avec fallback silencieux (masquer si absent).
6. **États produit — vérification visuelle des 6 états** (spec §13) :
   - `AVAILABLE_EMPTY` : Ajouter au panier + Acheter maintenant côte à côte
   - `AVAILABLE_FILLED` : Stepper + Acheter maintenant
   - `OUT_OF_STOCK` : Me prévenir pleine largeur, prix visible, variantes visibles
   - `SELECTION_REQUIRED` : CTA désactivés + indication de sélection
   - `LOADING` : désactivation double-clics
   - `ERROR` : revert optimiste + toast
7. **Actions inline desktop** : retour au flex simple (2 boutons flex:1 en `AVAILABLE_EMPTY`, stepper auto + acheter flex:1 en `AVAILABLE_FILLED`). Retrait du `grid-template-columns` triple.
8. **Fond mobile continu cream** : vérification finale que la zone scroll est `--page-bg` sauf sticky footer.
9. Régénération dist + gates complets.
10. Capture de contrôle sur les 6 viewports et sur les 6 états produit.
11. Commit 2.

**Critère de sortie Passe 2** : chaque viewport et chaque état produit rend une composition stable, sans layout shift entre `productInCart` false → true, sans jump, sans halo. Tous les gates verts.

### Passe 3 — Finition premium, transitions et micro-détails

**Objectif** : rendu premium, sobre, silence graphique sur les éléments non actionnés. Aucune micro-interaction qui appelle l'œil sans raison.

**Sous-tâches ordonnées :**

1. **Purge micro-interactions parasites** : hover-lift (translateY), scale (transform), halos (box-shadow colorés), animations de spring (fav btn `k-pop`), pulse rouge (mic listening), keyboard hint kbd. Neutralisation dans le scope `#k-modal` PDP. Conserver uniquement :
   - Fade image sur changement de variante (100 + 100 ms, spec §7.1)
   - Morph sticky empty ↔ filled (200 ms ease-out, spec §7.3)
   - Focus visible `outline: 2px solid var(--accent-blue); outline-offset: 2px` (spec §8)
2. **Ombres normalisées** : une ombre modale douce (`0 24px 60px rgba(44,44,42,0.10)` via token), une ombre sticky (`0 -1px 0 var(--border)`), rien d'autre. Retrait de tous les `box-shadow` sur miniatures, cards suggestions, payment tabs, CTA hover halos.
3. **Radius modal desktop** : 12 px (spec §4), retrait du 26 px.
4. **Ombre modal en gris chaud** : neutre dérivé de `--text-primary`, retrait des halos ocean.
5. **`prefers-reduced-motion: reduce`** : vérification que les transitions résiduelles sont bien neutralisées.
6. **Nettoyage littéraux tokens** : toute couleur ou opacité littérale introduite en Passe 1 ou 2 remplacée par un token de `tokens.css` (doctrine.max = 0).
7. Régénération dist + gates complets.
8. Capture finale sur les 6 viewports et les 6 états produit.
9. Comparaison finale vs maquette (M1 à M11, D1 à D13, T1 à T4 tous fermés).
10. Commit 3.

**Critère de sortie Passe 3** : rendu premium indistinguable de la maquette à l'œil nu sur les 6 viewports, `check:all` vert, `test:unit` vert, `map:check` vert, `audit:features` vert.

---

## 4. Corrections détaillées (référence rapide)

### Écarts mobile

| ID | Écart | Correction | Fichier probable | Priorité |
|---|---|---|---|---|
| M1 | Pill stock absent à droite du prix | Layout flex baseline, pill vert conforme spec §5.5 | `modal-product.css` + rendu `b-modal-mobile-product.js` | bloquant |
| M2 | Sélecteur Couleur absent | Vérifier §5.1 d'abord (modules orphelins) puis rendre si nécessaire | `modal-mobile-canonical.css` + `b-modal-mobile-product.js` | bloquant |
| M3 | Sélecteur Taille absent | Idem M2 | idem | bloquant |
| M4 | Carrousel suggestions vide | Rendre spec §5.7 | `b-modal-mobile-product.js` + styles carrousel | bloquant |
| M5 | Référence produit invisible | 11 px / 400 / muted sous le titre | `modal-product.css` + renderer | important |
| M6 | Meta hero ligne 2 = « CHAUSSURES » au lieu de série | Brancher `product.series` avec fallback silencieux | `b-modal-image-ux.js` ou renderer | polish |
| M7 | Badge panier coral au lieu de vert | `background: var(--success)`, border `1.5px solid var(--page-bg)` | `modal-shell.css` L82 | bloquant |
| M8 | Fond blanc après hero au lieu de cream continu | `background: var(--page-bg)` sur zone scroll (sauf sticky) | `modal-shell.css` §1 | important |
| M9 | Icônes bag + bolt absentes des CTA | Ajout icônes 16 px + gap 6 px | `b-modal-buybox-shared.js/renderPdpActions` | important |
| M10 | Stepper radius 50 px au lieu de 8 px | `border-radius: 8px; background: var(--hero-bg)` | `modal-shell.css` L256 | polish |
| M11 | CTA « Me prévenir » bordure coral | `border: 1.5px solid var(--text-primary)` | `modal-shell.css` L266 | bloquant |

### Écarts desktop

| ID | Écart | Correction | Fichier probable | Priorité |
|---|---|---|---|---|
| D1 | Prix coral massif (34-56 px, 850) | 28 px / 500 / `--text-primary`, unité 13 / 500 muted, source unique | `modal-shell.css` L619-627 + `modal-product-lot4-hybrid.css` L61-64 | bloquant |
| D2 | Titre 30-46 px extra bold `--font-display` | 18 px / 500 / line-height 1.2, source unique | `modal-shell.css` L611 + `modal-product-lot4-hybrid.css` L48-56 | bloquant |
| D3 | CTA Acheter `--ocean` (bleu) | `--success` aplat, source unique, retrait gradient | `modal-shell.css` L263 + L688 + `components.css` L2230 | bloquant |
| D4 | Panneau surchargé (meta, desc, old-price, delivery, payment, relay, trust, share, specs, fav, back-top, flash-bar) | Désactivations propres selon D-P1 : enhancers (A), approche-C (A), delivery/payment/subtotal sous suggestions (B), favori retrait DOM (A) | `b-modal-desktop-enhancers.js`, `main.js` (retrait import approche-C), `b-modal-desktop-product.js`, `index.html` | bloquant |
| D5 | Meta hero ligne 2 identique à M6 | Idem M6 | idem M6 | polish |
| D6 | Hero dégradé radial + linéaire | Aplat `background: var(--hero-bg)`, conserver `.k-modal-hero-decor` | `modal-product-lot4-hybrid.css` L24-28 | important |
| D7 | Zone produit gradient radial + panneau détails gradient | Aplat `background: var(--page-bg)` | `modal-product-lot4-hybrid.css` L19-22 + L36-39 | important |
| D8 | Grille 84 / 1fr / 320-380 | Aligner spec §6 : 60 / 1fr / 310 (1024-1439), 64 / 1fr / 340 (≥1440) | `modal-product-lot4-hybrid.css` L17 | important |
| D9 | Rail miniatures hover-lift + halo coral-focus | Border sombre plate, sans transform, sans halo | `modal-shell.css` L534-537 | important |
| D10 | Suggestions fond sand-warm dégradé + titre 22-30 px | Aplat `--page-bg`, border-top dashed, titre 15 / 500, retrait ombres cards | `modal-product-lot4-hybrid.css` L349-373 + `modal-shell.css` L724-751 | important |
| D11 | Actions grid 3 cols + subtotal | Flex 2 boutons, subtotal masqué | `modal-shell.css` L674-708 + `modal-product-lot4-hybrid.css` L139-183 | important |
| D12 | Radius modal 26 px | 12 px | `modal-shell.css` L934 | polish |
| D13 | Ombre modal ocean | Ombre gris chaud neutre | `modal-shell.css` L473 + L936 | polish |

### Écarts transverses

| ID | Écart | Correction | Priorité |
|---|---|---|---|
| T1 | Graisses 600-900 partout | Normalisation scoped `#k-modal` PDP à 400/500, cas par cas | bloquant |
| T2 | Coral utilisé comme accent partout | Purge du coral hors `.k-modal--has-promo` et `.k-modal-promo-badge` | bloquant |
| T3 | Micro-interactions parasites | Conserver uniquement fade variante + morph sticky + focus | important |
| T4 | Ombres et dégradés qui saturent | Une ombre modale, une ombre sticky, rien d'autre | important |

### Notes retirées de mon audit précédent après lecture du graphe 360

- **Meta row Bestseller/rank/étoiles** (`k-modal-meta`) : mort au runtime, `b-modal-social-proof.js` écoute `modal:product-changed` sans émetteur. Aucune correction visuelle nécessaire. Le CSS de `modal-shell.css` L582-607 reste orphelin, à traiter en dette séparée.
- **Description italique `.k-modal-desc`** : le style est là (`modal-product-lot4-hybrid.css` L72-79) mais son rendu dépend de la présence de contenu dans le DOM. Vérifier avant correction.

---

## 5. Vérifications préalables

### 5.1 Vérification mobile orpheline (avant M2/M3)

**Problème** : le graphe 360 indique que `b-mobile-modal-v1.js` et `b-mobile-premium-v1.js` écoutent `modal:opened` avec `usedBy: []`. `BOUTIQUE_COMPONENT_OWNERSHIP.md §6.2` les liste comme dette explicite (variantes/expérimentations à trancher).

**Procédure** :

1. Grep dans `public/boutique/index.html` : `<script[^>]*(b-mobile-modal-v1|b-mobile-premium-v1)`
2. Grep dans `public/boutique/js/main.js` et tous les entry points : `import.*mobile-modal-v1|mobile-premium-v1`
3. Grep dans `public/boutique/js/*.js` : usage éventuel

**Cas A — chargés en `<script>` tag ou side-effect import** : ce sont probablement les coupables de M2/M3. Ils interceptent `modal:opened` et injectent un markup mobile alternatif qui court-circuite `b-modal-mobile-product.js`. **Correction** : retirer les chargements, laisser le renderer canonique tourner. Documenter la suppression dans `BOUTIQUE_COMPONENT_OWNERSHIP.md §6.2` (passe de la dette à « supprimé »). Mise à jour du gate `feature:check`.

**Cas B — non chargés, vraiment orphelins** : le renderer canonique tourne, mais M2/M3 est peut-être un artefact du produit test (LEGACY_VARIANTS avec `selection_supported: false`). Vérifier la fixture utilisée pour la capture livrée. Si LEGACY : aucune correction, comportement conforme au contrat. Si SKU : bug dans `b-modal-mobile-product.js` à corriger.

### 5.2 Vérification `modal-mobile-canonical.css` et `modal-enriched-content.css`

Ces deux fichiers sont dans le bundle `components.css` selon `BOUTIQUE_360.md §3` mais absents du zip livraison différentiel. Sonnet doit :

1. Ouvrir chaque fichier et lire son contenu intégral
2. Identifier les sélecteurs owned : Couleur mobile, Taille mobile, pill stock, contenu enrichi sous les suggestions
3. Mettre à jour la table §4 « Corrections détaillées » avec les vrais fichiers propriétaires si différents des estimations
4. Traiter les corrections dans les fichiers réellement propriétaires (pas dans un autre fichier qui volerait l'ownership)

### 5.3 Vérification de la fixture de test capture

Le zip livraison contient `desktop-1440.png`, `desktop-1024.png`, `mobile-panier-vide.png`, `mobile-produit-au-panier.png`, `mobile-rupture-stock.png`. Ces captures sont-elles produites avec un vrai produit SKU (avec `option_axes[]` et `sellable_units[]` peuplés) ou un produit LEGACY_VARIANTS ?

Grep dans `run_playwright.py`, `run_browser_tests.py`, `run_actual_state_machine.py` du dossier `04_VALIDATION_ET_PREUVES` pour identifier la fixture. Si LEGACY, refaire les captures de contrôle avec un produit SKU pour valider Passe 1.

---

## 6. Checklist de validation visuelle finale

### Mobile 360 px (iPhone SE)

- [ ] Aucun scroll horizontal
- [ ] Titre sur 2 lignes maximum ellipsis
- [ ] Prix + pill stock sur la même ligne baseline
- [ ] Bloc Couleur : 5 vignettes visibles ou scroll-x sans scrollbar
- [ ] Bloc Taille : au moins 4 chips sur une ligne
- [ ] Carrousel suggestions : 2 cards partiellement visibles, coupe nette derrière le sticky
- [ ] Sticky footer ≤ 30 % de la hauteur écran
- [ ] Badge panier lisible sur `--success`
- [ ] Icônes bag + bolt visibles dans les CTA

### Mobile 390 px (iPhone 15/16)

- [ ] Idem 360 px
- [ ] 3 mini-cards suggestions partiellement visibles
- [ ] Chips taille 42/43/44/45 sur une ligne sans scroll

### Mobile 430 px (iPhone 15 Pro Max)

- [ ] 5 vignettes couleur toutes visibles sans scroll
- [ ] Padding latéral inchangé 16 px
- [ ] Hero 240 px de haut fixe

### Desktop 1024 px (laptop 13")

- [ ] Grille 60/1fr/310 (ou plage 1024-1199 selon la source unique)
- [ ] Titre + prix + stock + Couleur + Taille + CTA visibles sans scroll vertical
- [ ] Rail 4 miniatures visibles
- [ ] Suggestions : 4 cards en ligne
- [ ] Aucun onglet paiement, aucun encart relais, aucun trust, aucun partage, aucun favori dans le panneau

### Desktop 1440 px (poste bureautique standard)

- [ ] Grille 64/1fr/340, gap 22 px, padding 22 px
- [ ] Hero image cadré ~430 px de haut
- [ ] Panneau : titre 18/500 → ref muted → prix 28/500 dark → pill stock vert → Couleur → Taille → 2 CTA côte à côte 44 px
- [ ] Suggestions : 4 cards, titre 15/500, séparateur dashed haut
- [ ] Delivery + payment sous les suggestions (spec §11), pas dans le panneau

### Desktop large (≥ 1600 px)

- [ ] Modale plafonnée à `min(1180px, 100vw - 48px)`
- [ ] Marges latérales confortables
- [ ] Hero max 500 px de côté
- [ ] Panneau commercial largeur nominale (340 px), pas d'étirement

### Contrôles transverses (tous viewports)

- [ ] Aucun coral visible dans la modale sauf badge HOT (`--accent-orange`) et cas `.k-modal--has-promo`
- [ ] Aucune graisse > 500 sur du texte (sauf D-P3 promo si applicable)
- [ ] Aucun dégradé sur le hero ni sur les fonds de zone
- [ ] Focus clavier visible avec outline `--accent-blue`
- [ ] `prefers-reduced-motion: reduce` neutralise morph et fade
- [ ] État `OUT_OF_STOCK` : prix visible, variantes visibles, CTA unique « Me prévenir » neutre
- [ ] État `AVAILABLE_FILLED` : stepper radius 8 px + CTA acheter vert plein, sans halo
- [ ] Gate `render-static` de `modal-product.feature.js` reste vert (product-zone en grid, image mobile ancrée, etc.)
- [ ] Cliquet `boutique:360:check` non aggravé
- [ ] Cliquet `doctrine tokens` non aggravé (0 littéral rgba dans scope modal-product)

---

## 7. Livrables en fin de chantier

Sonnet livre en fin de chantier :

1. Une PR unique avec 3 commits internes (Passe 1, Passe 2, Passe 3)
2. Les 6 captures de contrôle finales (2 mobile + 4 desktop)
3. Un rapport de synthèse `RAPPORT_CHANTIER_PDP_MAQUETTE_PREMIUM.md` qui reprend :
   - Ce qui a été fait par passe
   - Les décisions prises quand un point non couvert par ce document est apparu
   - Les gates verts confirmés
   - Les régressions évitées (référence au correctif du 18 juillet)
   - La comparaison avant/après par écart (M1-M11, D1-D13, T1-T4)
   - Les dettes ouvertes qui restent (par exemple `b-modal-social-proof.js` mort à traiter séparément, `modal:product-changed` écouteur orphelin à trancher, `sidebar:built` émission orpheline à trancher)

Le chantier est considéré terminé quand :

- Tous les gates de §1 sont verts
- `npm run check:all` est vert
- `npm run test:unit` est vert avec 100 % de couverture sur les fichiers touchés
- Les 6 captures correspondent visuellement à la maquette
- Le rapport de synthèse est livré

---

## 8. Ce qui ne doit jamais arriver

- Refactorer l'architecture, la state machine ou la logique panier
- Créer une seconde source de vérité (prix, stock, livraison, sous-total)
- Compenser une erreur JS par du CSS ou l'inverse
- Éditer directement les fichiers `dist/*.css`
- Introduire un `rgba(...)` littéral dans le scope modal-product
- Aggraver un cliquet (bus 360, doctrine tokens, ownership)
- Régresser les tests du correctif final PDP-1 / PDP-2 du 18 juillet
- Rouvrir le chantier après Commit 3 pour un ajout qui aurait pu vivre dans les décisions §2
- Casser un gate `render-static` positif du manifeste `modal-product.feature.js`

---

*Ouvert une seule fois. Fermé quand la maquette est atteinte. Rapporté quand c'est fait.*
