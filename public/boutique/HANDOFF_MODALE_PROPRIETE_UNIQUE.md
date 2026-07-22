# HANDOFF — Modale produit : responsabilité unique (reprise agent)

> **Destinataire : Claude Sonnet (exécution).** Ce document est un runbook exécutable.
> L'**analyse finale de validation** est réservée à un second passage (Opus) — ne pas
> l'auto-certifier « terminé » sans avoir fait passer les deux oracles ci-dessous.
>
> **Oracle 1 (ownership)** : `npm run audit:modal-ownership` → doit sortir en **exit 0**.
> **Oracle 2 (non-régression)** : `npm run test:unit` → **0 échec**.
> Les deux depuis `public/boutique`. Aucun chantier n'est « fini » tant que les deux ne sont pas verts.

---

## 0. Contexte & état actuel (déjà fait, ne pas refaire)

La modale produit était peinte par **18 fichiers JS (~230 Ko)** : multi-ownership massif.
Mesure initiale du gate : **13 zones / 21 multi-écrites**, cause unique = `b-modal-core.js`
(le paint legacy de `openModal`).

Déjà livré et vérifié :
1. **Gate d'ownership** `scripts/audit-modal-ownership.js` + contrat `scripts/modal-ownership.contract.json`.
   Câblé dans `check:all` / `check:fast` (CI). Conscient de la joignabilité (le code mort
   ne compte pas comme violation runtime mais est signalé).
2. **Manche 1** : extraction du contenu scalaire hors de `openModal` vers l'owner unique
   `js/b-modal-product-fields.js` (`paintProvisionalFields`). **8 zones scalaires passées au vert.**
   Gate : **13 → 5**.
3. **`index.html`** : commentaire d'owner corrigé (pointait le module no-op `b-modal-desktop-enhancers.js`).
4. **Correctif viewport (manche 0) : RETIRÉ** de la branche (revert). Il unifiait le
   routage sur `isDesktop()` mais cassait 26 tests qui pilotent le viewport en mockant
   `matchMedia`. **Ne pas le réappliquer sans le lot de mises à jour de tests** (cf. §4).

**Point de départ de ta reprise** : gate = **5 violations**, `test:unit` = **vert**.

---

## 1. Invariants & garde-fous (NON négociables)

- **Une zone = un owner.** Le contrat `modal-ownership.contract.json` est la source de vérité.
  Pour lever une violation : soit tu **déplaces** l'écriture chez l'owner, soit tu ajoutes le
  fichier dans `allow` **uniquement** si la co-écriture est intentionnelle ET tu documentes
  la `reason`. Jamais d'`allow` de confort pour faire taire le gate.
- **La couche données est déjà unifiée** : `b-modal-desktop-product.js` et
  `b-modal-mobile-product.js` importent tous deux `view-models/modal-selection-model.js`,
  `view-models/product-content-model.js`, `b-modal-buybox-shared.js`, `b-modal-product.js`.
  **Ne PAS fusionner** des rendus DOM légitimement différents (pill mobile vs texte desktop).
  La duplication à traiter est au **DOM scalaire** seulement (cf. Chantier 2).
- **Ne jamais supprimer un module à l'aveugle** : plusieurs morts ont des tests ET des
  manifestes (`features/*.feature.js`). Suppression = opération gouvernée multi-fichiers (§5).
- **Ne pas toucher au chemin fail-closed** : `b-modal-product-detail-bootstrap.js` verrouille
  le transactionnel avant le fetch `/detail` (`lockTransactionalPath`). C'est volontaire.
- Après chaque étape : `node --check` sur les fichiers touchés, puis les deux oracles.

---

## 2. CHANTIER DESKTOP — clore les 5 violations restantes

Toutes causées par `b-modal-core.js`. Ordre conseillé : du plus sûr (suppression de
redondance) au plus délicat (déplacement de comportement). Chaque item est indépendant :
commit + oracles entre chacun.

### 2.1 `k-modal-variants` — SUPPRESSION (redondant) · risque : faible
`b-modal-core.js:245` : `if (_variantContainer) _variantContainer.innerHTML = '';`
Redondant : les trois renderers vident déjà le conteneur
(`b-modal-desktop-product.js:610`, `b-modal-mobile-product.js:614`) et le bootstrap pose un
skeleton qui l'écrase. **Action** : supprimer la ligne 245 (et le lookup `_variantContainer`
l.243-244 s'il n'est plus utilisé ailleurs — vérifier). Contrat : retirer `b-modal-core.js`
de la réalité (il n'y sera plus). Owner reste `b-modal-desktop-product.js`.

### 2.2 `k-qty-val` — SUPPRESSION (redondant) · risque : faible
`b-modal-core.js:251` : `dom.modalQtyVal.textContent = state.modalQty;`
Redondant avec `_syncModalQtyUI()` (appelé l.235, **importé de `b-modal-cart.js`** = l'owner).
**Action** : supprimer la ligne 251. La synchro qty reste chez `b-modal-cart.js` via
`_syncModalQtyUI`. Owner inchangé (`b-modal-cart.js`).

### 2.3 `k-add-cart-btn` — SUPPRESSION (écrasé) · risque : faible-moyen
`b-modal-core.js:229-232` : reset d'état du bouton (`disabled=false`, `onclick=null`,
`classList.remove(...)`) à l'ouverture. **Écrasé immédiatement** : `openModal` émet
`modal:opened` → le bootstrap appelle `lockTransactionalPath()` (`disabled=true`), puis
`renderActions` (dans les renderers PDC) fixe l'état réel après fetch. Le reset de core est
donc mort-né. **Action** : supprimer les l.229-232. **Vérifier** que `b-modal-cart.test.js`
et `b-modal-core*.test.js` restent verts (ils testent l'état post-render, pas ce reset).
Owner : `b-modal-desktop-product.js` (allow `b-modal-mobile-product.js`, `b-modal-cart.js`).

### 2.4 `k-sug-rail` — DÉCISION (recherche interne) · risque : faible
`b-modal-core.js` écrit le rail à `l.201-202` (reset filtre recherche : retire `search-hidden`)
et le lit/manipule à `l.630, 947, 1023` (filtrage recherche interne modale, HOTFIX #213).
C'est une **responsabilité distincte** du peuplement du rail (owner `b-modal-suggestions.js`) :
c'est la **recherche intra-modale** qui filtre des cartes déjà rendues.
**Action par défaut (légère)** : ajouter `b-modal-core.js` dans `allow` de `k-sug-rail` avec
`reason: "filtrage recherche interne modale (search-hidden), distinct du peuplement par suggestions.js"`.
**Action propre (optionnelle, recommandée à terme)** : extraire ce comportement dans
`js/b-modal-search.js` (owner dédié de l'interaction recherche), et faire de lui l'`allow`.
Ne fais l'extraction que si `b-modal-core.test.js` couvre le comportement (sinon, défaut).

### 2.5 `k-buy-now-btn` — DÉPLACEMENT (comportement) · risque : moyen
`b-modal-core.js:557-576` : core attache le handler `click` de « Acheter maintenant »
(`addToCart` + animation de confirmation). L'owner est le renderer PDC (`renderActions`).
**Action** : déplacer ce câblage vers **`b-modal-buybox-shared.js`** (déjà importé par les
DEUX renderers → mutualise desktop+mobile, synergie avec le Chantier 2), exposé en fonction
appelée par `renderActions`. Retirer les l.557-576 de core.
**Vérifier** : `b-modal-buybox-shared.test.js`, `b-modal-desktop-product.test.js`,
`b-modal-mobile-product.test.js` (attention : ce dernier est réparé par le revert §4 —
ne pas le casser). C'est le seul item qui déplace un comportement : commit isolé, oracles avant/après.

**Definition of done Chantier Desktop** : `npm run audit:modal-ownership` → **exit 0, 0 violation** ;
`npm run test:unit` → vert. Mettre à jour le tableau du contrat et supprimer toute entrée
`b-modal-core.js` devenue caduque des `allow`.

---

## 3. CHANTIER DÉDUPLICATION — converger les deux renderers (le DOM scalaire uniquement)

**Nature réelle** (mesurée) : desktop et mobile sont deux renderers ~25 Ko qui réimplémentent
les mêmes responsabilités. MAIS la couche **données/état est déjà partagée** (view-models
communs). Ne converger QUE ce qui est **le même DOM ET la même donnée**.

### À converger (gain réel, DOM identique `#k-modal-*`)
`renderIdentity` + `renderPriceAndReference` existent **des deux côtés** et écrivent les mêmes
nœuds scalaires (`#k-modal-name/-sku/-desc/-price/-old-price/-cat/-promo-badge`).
`b-modal-product-fields.js` (manche 1) possède déjà le **paint provisoire** de ces nœuds.
**Action** : y ajouter `paintDetailFields(detail, selection)` — extraction verbatim des corps
de `renderIdentity` + `renderPriceAndReference` (choisir la version desktop comme référence,
vérifier la parité mobile via test). Les DEUX renderers appellent alors `paintDetailFields`
au lieu de réimplémenter. Contrat : owner de ces zones reste `b-modal-product-fields.js`,
`allow` **vidé** (plus aucun renderer n'écrit ces nœuds directement) → propriété devenue
strictement unique.

### À NE PAS fusionner (DOM légitimement différent, état déjà partagé)
- **Stock** : `renderStock` (texte desktop) vs `renderStockPill` (pill mobile). DOM différent
  par design. Se contenter d'extraire l'éventuelle **logique d'état** (in/low/out + seuils)
  dans un helper partagé si elle diverge ; garder deux rendus.
- **Enrichi** : `renderEnrichedContent` (desktop, `#k-modal-enriched-content`) vs
  `renderBelowFold` (mobile, `k-mdm-*`). **La donnée est déjà partagée**
  (`buildProductContentViewModel`). Placement/DOM différents = OK, ne pas fusionner.
- **Variantes** : `renderAxis` des deux côtés, mais `createModalSelection` déjà partagé.
  DOM différent = OK.

**Definition of done Chantier Déduplication** : `renderIdentity`/`renderPriceAndReference`
n'existent plus qu'une fois (dans `b-modal-product-fields.js`) ; `allow` des zones scalaires
vidé ; les deux oracles verts ; parité desktop/mobile prouvée par
`modal-mobile-desktop-parity.test.js` (le maintenir/étendre).

---

## 4. Correctif viewport (optionnel, séparé — NE PAS bundler)

Le self-abort fractionnaire `[899,900)` (`renderDesktopProductDetail` garde sur `isDesktop()`
= `innerWidth>=900`, bootstrap routait sur `matchMedia('max-width:899px')`) a été **reverté**
car il cassait 26 tests. Pour le refaire proprement, en **un seul lot avec ses tests** :
1. Unifier le chemin modale sur `isDesktop()` : `viewportMode()` (bootstrap) et
   `isMobileViewport()` (mobile renderer) → `isDesktop()` / `!isDesktop()`.
2. **Basculer les mocks de tests** de `matchMedia` vers `isDesktop` :
   - `tests/unit/b-modal-mobile-product.test.js:75`
   - `tests/unit/b-modal-product-detail-bootstrap.test.js:82,151,179,284`
   - `tests/unit/b-modal-product-detail-bootstrap-pdc6-coverage.test.js:66-70`
   (mocker `require('../../js/b-scroll-owner.js').isDesktop` comme le fait déjà
   `b-modal-desktop-product.test.js:18`).
3. Oracle : `test:unit` vert. **Ne livrer que si vert.**
Priorité **basse** : ce n'est PAS le déblocage desktop (c'était le multi-ownership + le
commentaire mort). À faire après les deux chantiers principaux.

---

## 5. Code mort — suppression gouvernée (multi-fichiers)

Injoignables depuis `main.js`, à supprimer **avec** leurs tests et manifestes :
- `js/b-mobile-modal-v1.js` + `tests/unit/b-mobile-modal-v1.test.js` + entrées dans
  `features/boutique.feature.js` (l.61,104) + `@used-by` de `b-bus.js`.
- `js/b-modal-approche-c-hybrid.js` + `tests/unit/b-modal-approche-c-hybrid.test.js` +
  entrées `features/modal-product.feature.js` (l.66,85,123,145) + `tests/unit/main.test.js`
  (assertion T-016 qui vérifie l'absence d'import — à conserver/adapter).
- `js/b-mobile-premium-v1.js` + `tests/unit/b-mobile-premium-v1.test.js` (+ manifeste éventuel).
- `js/dist/main-*.js` : bundle JS non chargé (l'`index.html` sert la source `main.js?v=351`).

Oracle : `test:unit` vert + `npm run feature:guard:strict` (si présent) vert. Le gate cesse
de signaler ces modules une fois disparus du disque.

---

## 6. CHANTIER UI — référence visuelle + `shipping_mode`

**Référence visuelle absolue** : `docs/reference/reference-modale-4-etats.html` (4 états rendus,
calés sur l'identité réelle : crème, serif vert forêt, CTA vert, icônes ligne). Toute
décision de layout se tranche contre ce fichier, pas à vue.

### 6.1 Décisions verrouillées (à respecter, ne pas réinventer)
- **Invariant DENSITÉ-ROBUSTE (vérifié par `npm run audit:modal-layout` + `tests/unit/modal-layout-invariant.test.js`)** :
  la modale est **un seul conteneur qui scrolle + CTA sticky**. Aucune `height` fixe en px
  sur les zones de flux (`.k-modal-scroll`, `.k-modal-info`, `.k-modal-img-wrap`, carousel,
  `.k-modal-variants`, `.k-mdm-root/fold`, `.k-modal-opt-body`) — relatif/flex/vh + min/max px
  bornés uniquement. Variantes en `flex-wrap` (peu → 1 ligne ; 22 coloris → plusieurs lignes
  qui scrollent). **Aucune logique JS de fold-fitting.** Baseline : gate **déjà vert** — le
  travail est de NE PAS le casser en passant au modèle. Modèle : `docs/reference/reference-modale-architecture.html`.
  À 3 variantes les suggestions affleurent ; à 22, la grille couleur — même code, la densité décide.
- **4 états** : mobile/desktop × enrichi/non-enrichi. Enrichi = `hasEnrichedContent` + variantes
  (rail miniatures, hero éditorial, swatches, suggestions). Non-enrichi = simple.
- **Réassurance, partage ET suggestions sont TOUJOURS montés** — jamais conditionnés à
  `hasEnrichedContent`. Les suggestions du non-enrichi sont du **cross-sell** (autres produits),
  pas du faux contenu enrichi sur l'article.
- **Média desktop** : le cadre image remplit la hauteur de la colonne (`flex` stretch, aligné
  sur la buybox), mais le **produit reste modeste** — `object-fit: contain`, pas de gonflement
  (surtout non-enrichi, image capée). Fond crème visible autour.
- **Swatches couleur = vignettes produit par coloris** (image de variante issue de `media` du SKU),
  jamais des pavés unis. Badge `NEW` sur la variante nouvelle.
- **Mobile enrichi** : Couleur **et** Taille visibles au-dessus du CTA (choix immédiat). C'est
  l'espace que libère l'optimisation topbar — les deux chantiers se tiennent.
- **Topbar mobile** : `meta theme-color` = crème (statusbar fondue dans le hero), image
  full-bleed, header en `position:absolute` par-dessus l'image (plus de bande opaque), barre
  CTA `position:sticky; bottom:0`. Pas d'overlay redondant (tap image = plein écran natif).
- **Bouton panier ↔ stepper** (micro-interaction) : quantité 0 → bouton « Ajouter au panier » ;
  après ajout → stepper `− N +` qui pilote la quantité ; retour à **0** via le `−` → le stepper
  disparaît, le bouton réapparaît **et l'article est retiré du panier**. Un seul contrôle qui
  change d'état, jamais les deux affichés simultanément.

### 6.2 `shipping_mode` — nouvel attribut produit
Livraison **aérienne express** vs **maritime** (défaut, 3–5 semaines). C'est un **attribut de
décision** : il se rend au niveau du coup d'œil, **en pill sous le prix, à côté du stock** — pas
dans le bandeau de réassurance (invariant), pas en bas (enfoui).

**Contrat détail** — ajouter au view-model partagé (`view-models/product-content-model.js` ou un
`delivery-model` dédié, importé par les deux renderers) :
```
delivery: {
  mode: "air" | "sea",            // défaut "sea" si absent
  lead_time_label: "3–5 jours" | "3–5 semaines"
}
```

**Rendu** — pill dans la zone livraison de la buybox :
- `air` → pill **accent** (classe type `--text-accent` / bg bleu clair), icône avion,
  ex. « Livraison express · avion · 3–5 jours ».
- `sea` → pill **neutre** (gris), icône bateau, ex. « Livraison maritime · 3–5 semaines ».
- Owner : zone `k-modal-delivery` (déjà **owner unique** `b-modal-desktop-product.js` + équivalent
  mobile). **Aucun nouveau propriétaire** — un champ de plus dans le renderer existant.
- Supprimer l'ancienne ligne « Livraison point relais · 3 à 5 semaines » en bas : doublon avec la
  pill (délai) et le bandeau (« Retrait en relais » = lieu).

**Messaging** : « express » n'a de sens **que par contraste**. Tant que le défaut boutique reste
maritime, l'aérien prend l'accent ; si un jour tout passe en aérien, aligner les deux en neutre.

### 6.3 Oracles UI (tests à ajouter)
- **shipping_mode** : contrat `delivery.mode="air"` → pill rendue avec la classe accent + libellé
  « express/avion » ; `"sea"` → pill neutre « maritime » ; champ absent → fallback `sea` (ou pas de
  pill, selon décision produit — trancher et tester le choix). À couvrir des **deux** côtés via
  `modal-mobile-desktop-parity.test.js`.
- **bouton panier ↔ stepper** : `qty 0` rend le bouton ; ajout → stepper ; `qty 1 → −` →
  `removeFromCart` appelé **et** bouton « Ajouter au panier » ré-affiché (pas de ligne fantôme à 0).
- Ne pas régresser : `renderIdentity`/prix/swatches restent sous leur owner unique (le gate
  d'ownership doit rester **exit 0** après ces ajouts).

---

## 7. Séquence recommandée & commandes

```bash
cd public/boutique

# CHANTIER DESKTOP (2.1 → 2.5, un commit + oracles par item)
npm run audit:modal-ownership   # 5 → … → 0
npm run test:unit               # vert à chaque étape

# CHANTIER DÉDUPLICATION (§3)
npm run test:unit
npm run audit:modal-ownership   # doit rester 0, allow scalaire vidé

# CHANTIER UI + shipping_mode (§6) — se cale sur docs/reference/reference-modale-4-etats.html
npm run test:unit               # inclut les oracles shipping_mode + bouton↔stepper
npm run audit:modal-ownership   # doit rester 0 (pas de nouvel écrivain sur k-modal-delivery)

# CODE MORT (§5)
npm run test:unit
npm run feature:guard:strict

# GATE COMPLET AVANT REMISE
npm run check:fast              # inclut audit:modal-ownership + test:unit
```

**Ne pas** clore la reprise sans : `audit:modal-ownership` exit 0, `test:unit` 0 échec,
`check:fast` vert. Laisser l'analyse finale de validation au second passage.

---

## Annexe — fichiers de l'appareillage

- `scripts/audit-modal-ownership.js` — le gate (ne pas modifier sa logique sans raison).
- `scripts/modal-ownership.contract.json` — source de vérité de la propriété (à mettre à jour).
- `js/b-modal-product-fields.js` — owner unique du scalaire (à étendre en §3).
- `docs/reference/reference-modale-4-etats.html` — **référence visuelle absolue** des 4 états
  (+ micro-interaction bouton panier, pills livraison air/mer). Se caler dessus pour tout le §6.
- État attendu au démarrage de la reprise : **gate = 5 violations, test:unit = vert.**
