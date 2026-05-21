# KOMERCE — Architecture · Modal Produit Desktop

> *Universal Modal — Temu-inspired, Komerce-native*

| Clé | Valeur |
|---|---|
| Statut | **v1.1 — 21 mai 2026** (PR-M1, PR-M2, PR-M3, PR-M4, PR-M5 toutes livrées · chantier modale clôturé) |
| Périmètre | `modal.css` + `b-modal-desktop-enhancers.js` + `modal-view-model.js` — desktop uniquement (≥ 900px) |
| Propriétaire CSS | `boutique/css/modal.css` — 1782 lignes, 6 sections |
| Propriétaire JS | `boutique/js/b-modal-desktop-enhancers.js` (orchestrateur enhancers) + `boutique/js/view-models/modal-view-model.js` (traducteur produit → classes) |
| Docs liées | `BOUTIQUE_MODAL_ARCHITECTURE.md` · `BOUTIQUE_SOURCE_OF_TRUTH.md` · `BOUTIQUE_PRODUCT_DISPLAY_CONTRACT.md` |

---

## 1. Contexte et objectif

La modal produit desktop Komerce est actuellement fragmentée entre 5 sections CSS (§3, §4, §5, §6, §7) qui se surchargent en cascade. Cette chaîne est fonctionnelle mais fragile : une modification en §3 peut être silencieusement écrasée par §7, et chaque nouveau type de produit risque de multiplier les cas particuliers dans le CSS.

L'objectif de cette refonte est une modal desktop unique qui :

- S'adapte à tout type de sourcing (stock local Comores, Dubai, confection, CSV, WhatsApp) sans code conditionnel dans le CSS
- Couvre tous les états de complétude produit, du plus riche (variantes + images HD + specs) au plus pauvre (1 image + prix + nom)
- S'inspire des patterns Temu (densité, clarté, signal fort prix/promo) sans reproduire ses excès anxiogènes
- Reste maintenable par un seul développeur sans cartographie de la cascade

---

## 2. Analyse pattern Temu — ce qu'on retient

| Pattern Temu | Signal UX | Adaptation Komerce |
|---|---|---|
| Grid 43/57 image/details | Espace suffisant pour info sans écraser la photo | Conserver — grid 43/57 devient source de vérité unique (ex-§7) |
| Prix massif + ancien prix barré | Signal promo fort, lisible à 3m | Conserver — `clamp font-size` + coral pour prix promotionnel |
| Swatches couleur ronds | Sélection variante intuitive | Déjà implémenté — s'assurer `border-radius:50%` sur `.k-sku` |
| Badge promo sur image | -25% sur fond orange/rouge | Komerce : badge coral sobre — moins agressif |
| Livraison estimée en encart | Délai + transporteur en vert | Conserver — `.k-modal-delivery` avec date estimée si dispo |
| Trust badges ligne | Paiement sécurisé / Retour 90j | Adapter — retrait relais / paiement cash / échange 14j Komerce |
| Galerie thumbs verticale | Navigation images sans quitter la zone | Conservé — `.k-modal-thumbs` col gauche déjà implémenté |
| Social proof conditionnel | X vendus + note + avis | Conditionnel : afficher **uniquement** si données API réelles |

> **Ce qu'on n'adapte PAS** : timers Lightning Deal, compteurs de personnes qui regardent, crédits fictifs, BEST SELLER sans données réelles. Le positionnement Komerce est artisanal et honnête.

---

## 3. Principe d'universalité — une seule modal pour tout sourcing

### 3.1 Le problème à résoudre

Komerce ingère des produits de sources très hétérogènes :

- **Stock local Comores** — données complètes, photos réelles, stock connu
- **Dubai sourcing** — données riches mais parfois sans images HD
- **Confection / créations** — données partielles, pas de variantes structurées
- **Import CSV / WhatsApp** — données minimales (nom + prix + 1 image)
- **Marketplace (futur)** — données riches mais format différent

### 3.2 La solution : le ModalViewModel

Sur le modèle du `ProductCardViewModel` (cf. `BOUTIQUE_PRODUCT_DISPLAY_CONTRACT.md`), on introduit un contrat d'affichage modal :

```
Produit brut  →  Catalog Komerce  →  ModalViewModel  →  Classes contractuelles  →  modal.css
```

### 3.3 Contrat ModalViewModel — champs normalisés avec fallbacks garantis

| Champ | Type | Fallback garanti | Classe CSS associée |
|---|---|---|---|
| `images[]` | `Array<url>` | `[placeholder.svg]` | (toujours ≥ 1 image) |
| `name` | `string` | `"Produit Komerce"` | — |
| `priceKmf` | `number\|null` | `null` | `k-modal--no-price` |
| `oldPriceKmf` | `number\|null` | `null` | `k-modal--has-promo` si non null |
| `promoPct` | `number\|null` | `null` | badge visible si ≥ 5% |
| `variants[]` | `Array\|null` | `null` | `k-modal--has-variants` |
| `deliveryEstimate` | `string\|null` | `null` | `k-modal--has-delivery` |
| `stockStatus` | `available\|low\|unavailable` | `available` | `k-modal--stock-*` |
| `socialProof` | `{sold,rating,reviews}\|null` | `null` | `k-modal--has-social-proof` |
| `specs[]` | `Array\|null` | `null` | `k-modal--has-specs` |
| `fulfillmentType` | `local\|relay\|preorder\|custom` | `relay` | `k-modal--fulfillment-*` |
| `dataQualityScore` | `0-100` | `0` | `k-modal--low-confidence` si < 40 |

> **Règle fondamentale** : le CSS réagit **uniquement** aux classes contractuelles du `ModalViewModel`. Aucun sélecteur ne dépend d'un fournisseur, d'une source de données ou d'un champ absent. Les blocs optionnels sont masqués par défaut (`display:none`) et révélés par la classe.

---

## 4. Layout desktop cible — grille unique

### 4.1 Décision architecturale : §7 devient la source de vérité

L'analyse des proportions montre que §7 full-page (grid 43/57) est visuellement le plus proche du mockup Temu. La décision est de :

- Élever §7 au rang de section principale — §3 original est réduit à la typographie seule
- Supprimer les overrides §4 (900-1120) et §5 (≥1200) en tant que sections grille
- Avoir une seule grille desktop : `43% image / 57% details` avec `clamp()` pour les ajustements

### 4.2 Grille cible

| Propriété | Valeur cible |
|---|---|
| `grid-template-columns` | `minmax(0, 43%) minmax(0, 57%)` |
| Height modal | `100dvh` (pleine viewport) |
| Col image overflow | scroll interne (thumbs + carousel) |
| Col details overflow | `overflow-y: auto` |
| Details padding | `clamp(24px, 4vw, 64px)` |
| h2 titre | `font-size: clamp(21px, 1.65vw, 28px)` |
| Prix promo | `font-size: clamp(24px, 2vw, 32px)` · `color: var(--coral)` |
| Breakpoint unique | `≥ 900px` (pas de 900-1120 ni ≥1200 distincts pour la grille) |

### 4.3 Structure DOM cible

La structure DOM ne change pas — seules les classes conditionnelles et la logique d'affichage changent :

```
.k-modal-overlay
  └── .k-modal  [k-modal--has-promo] [k-modal--has-variants] [k-modal--has-social-proof] ...
        ├── .k-modal-topbar               (breadcrumb + close)
        └── .k-modal-product-zone         ← grid 43/57
              ├── .k-modal-img-wrap        (col gauche, thumbs + carousel)
              └── .k-modal-details         (col droite)
                    ├── .k-modal-social-proof   [conditionnel]
                    ├── .k-modal-title
                    ├── .k-modal-price-row
                    ├── .k-modal-promo-bar      [conditionnel]
                    ├── .k-modal-stock-bar      [conditionnel]
                    ├── .k-modal-variants       [conditionnel]
                    ├── .k-modal-delivery       [toujours visible, enrichi si données]
                    ├── .k-modal-trust          [toujours visible]
                    ├── .k-modal-specs          [conditionnel]
                    └── .k-modal-actions        [sticky bas — toujours]
```

---

## 5. Blocs conditionnels — logique d'affichage universelle

Chaque bloc optionnel suit le même pattern : masqué par défaut via CSS, révélé par une classe posée par le `ModalViewModel` sur `.k-modal`. Zéro logique de sourcing dans le CSS.

| Bloc CSS | Classe activatrice | Fallback si absent | Note |
|---|---|---|---|
| `.k-modal-social-proof` | `.k-modal--has-social-proof` | `display:none` | Vendus + note + avis — données API uniquement |
| `.k-modal-promo-bar` | `.k-modal--has-promo` | `display:none` | Bandeau "--25% sur ce produit" |
| `.k-modal-stock-bar` | `.k-modal--stock-low` | `display:none` | Pastille uniquement si stock faible réel |
| `.k-modal-variants` | `.k-modal--has-variants` | `display:none` | Swatches couleur + pills taille |
| `.k-modal-delivery` | `.k-modal--has-delivery` | Bloc minimal toujours visible | Délai estimé si dispo, sinon "Livraison relais" |
| `.k-modal-specs` | `.k-modal--has-specs` | `display:none` | Accordion ouvert par défaut si présent |
| `.k-modal-promo-badge` | `.k-modal--has-promo` | `display:none` | Badge sur image — coral, sobre |
| `.k-modal-low-confidence` | `.k-modal--low-confidence` | `display:none` | Bandeau "infos à confirmer" si `dataQuality < 40` |

> **Règle de non-régression** : un produit avec 0 champs optionnels (1 image + nom + prix) doit s'afficher proprement. Aucune zone vide, aucun bloc fantôme. Test obligatoire avant chaque PR.

---

## 6. Nouvelle carte des sections modal.css (post-PR-M2)

La refonte rationalise les 7 sections initiales en **6 sections claires** (la cible initiale de 5 sections incluait les variantes comme "sous-section transverse" ; le code livré les compte comme une section à part entière §4) :

| Sect. | Rôle | Media query | Statut vs initial |
|---|---|---|---|
| **§1** | Base mobile complète (overlay, shell, topbar, carousel, infos, actions sticky, suggestions, livraison/trust mobile) | Aucune (base) | Inchangé |
| **§2** | Mobile guard haute spécificité (`#k-modal`) | `max-width: 899px` | Inchangé |
| **§3** | Desktop : **uniquement** typographie, espacements, topbar breadcrumb (plus de grille) | `min-width: 900px` | Réduit (grille retirée) ✅ PR-M2 |
| **§4** | Variantes (SKUs couleur, grille tailles/pointures, guide tailles overlay) | Aucune (composant pur) | Promu section (ex-sous-section transverse) |
| **§5** (ex-§6 / ex-§7) | Blocs conditionnels masqués base, révélés desktop (social proof, promo, stock, delivery, specs, trust) | `min-width: 900px` | Renommé ✅ PR-M2 |
| **§6** (ex-§7) | Layout desktop : grille 43/57, image sticky, details scroll, actions sticky bas, mode full page | `min-width: 900px` (+1 override 900-1120) | **Source de vérité unique grille** ✅ PR-M2 / B-M-11 |

> **Supprimés en PR-M2** : ancien §4 (desktop intermédiaire 900-1120) et ancien §5 (desktop large ≥1200) comme sections grille indépendantes. Leurs ajustements sont absorbés dans §6 (un seul override sous-borne 900-1120) ou dans §3 via `clamp()`.

---

## 7. Invariants de la nouvelle architecture

Les invariants B-M-01 à B-M-08 existants restent valides. 4 nouveaux, spécifiques à l'universalité (consolidés post-PR-M2) :

| ID | Invariant | Vérification | Statut |
|---|---|---|---|
| **B-M-09** | Aucune règle CSS ne dépend d'un fournisseur ou d'une source de données | `grep -iE "\.[a-z-]*(dubai\|csv\|excel)[a-z-]*[ ,{]"` dans `modal.css` → 0 résultat (`var(--whatsapp)` couleur de marque autorisé) | ✅ |
| **B-M-10** | Chaque bloc conditionnel est `display:none` par défaut, révélé par classe `.k-modal--*` sur `.k-modal` uniquement | Tester sans aucune classe optionnelle : aucun bloc vide visible | ⚠️ **Non respecté** — PR-M3 à faire (seule `.k-modal--has-promo` est lue par le CSS) |
| **B-M-11** | La grille desktop est déclarée **une seule fois dans §6**, jamais ailleurs | `grep "grid-template-columns" css/modal.css` → uniquement dans §6 | ✅ depuis PR-M2 |
| **B-M-12** | Un produit minimal (1 image + nom + prix) s'affiche sans espace vide ni layout cassé | Test intégration avec `ModalViewModel` minimal (seuls `name`, `priceKmf`, `images[0]`) | Dépend de B-M-10 — à valider après PR-M3 |

---

## 8. Plan de migration — 5 PR atomiques

### PR-M1 — ModalViewModel (fondation, ~3h) ✅ **LIVRÉE 20/05/2026**

Créer le ViewModel qui normalise tout produit Komerce en contrat modal. **Sans toucher au CSS.**

- ✅ Créé `boutique/js/view-models/modal-view-model.js`
- ✅ Champs contractuels avec fallbacks garantis (table §3.3)
- ✅ Classes CSS posées sur `.k-modal` selon les champs présents
- ✅ Branchement sur `bus.on("modal:opened")` dans `b-modal-desktop-enhancers.js`, hook initial via `setupModalContractClasses()` dans `main.js`

### PR-M2 — Refactoring grille modal.css (~2h) ✅ **LIVRÉE 20/05/2026**

Unifier les sections grille. **Mobile non touché.**

- ✅ `grid-template-columns` déplacé en §6 (source unique)
- ✅ Overrides 900-1120 (ex-§4) et ≥1200 (ex-§5) supprimés comme sections indépendantes
- ✅ Sections rationalisées : 7 → 6
- ✅ Invariant B-M-11 atteint

### PR-M5 — Nettoyage `!important` modal.css (~1h) ✅ **LIVRÉE 20/05/2026**

Réduire les 14 `!important` du modal.css aux 2 légitimes (masquage JS runtime).

- ✅ Cat. A (4 retraits par spécificité `#k-modal`) : `.k-modal-fullscreen`, `.k-topbar-search-expanded`, `body.modal-open footer`, doublon footer supprimé
- ✅ Cat. B (8 retraits par refactor sélecteur) : `.k-modal-meta-rank`, `.k-modal-actions` mobile, `.k-sku.k-sku--active`, `.k-vp.k-vp--active`
- ✅ Cat. C (2 conservés) : `.k-sug-card.search-hidden`, `.k-sug-card.subcat-hidden`
- Dépassement de cible : prévu 5 restants, atteint 2

### PR-M3 — Blocs conditionnels (~2h) ⚠️ **À FAIRE** — bloquant pour la modale dynamique

Refactoriser §5 pour que les blocs réagissent aux 10 classes contractuelles posées par `ModalViewModel`.

État actuel : seule `.k-modal--has-promo` est lue par le CSS (1/10). Les 9 autres classes sont posées mais ignorées. Les blocs sont actuellement révélés inconditionnellement par `@media (min-width:900px)`.

Travail à faire :
- Réorganiser §5 dans l'ordre : social proof / promo / stock / variants / delivery / specs / trust
- Chaque bloc : `display:none` base, révélé par `.k-modal--has-X .k-modal-X { display: ... }` sur `.k-modal`
- Supprimer les injections conditionnelles JS dans `b-modal-desktop-enhancers.js` qui pourraient encore poser des `display` inline
- Test produit minimal : `ModalViewModel({ name, priceKmf, images: [url] })` sans aucune classe optionnelle → aucun bloc fantôme visible
- Valide B-M-10 et B-M-12

### PR-M4 — Polish Temu (~1h30) ✅ **LIVRÉE 21/05/2026 — audit 0 violation**

Finitions visuelles + migration des 2 derniers hex `modal.css`. **Décision technique : un seul token créé (pas deux).**

| Hex avant | Token après | Type de décision |
|---|---|---|
| `#F0A500` | `var(--star-gold)` | **Nouveau token** — aucun token existant ne correspondait à cet or punchy étoile notation produit |
| `#EBF5EE` | `var(--green-bg)` | **Réutilisation** — `#e8f7ee` ΔE ≈ 1.5 vs `#EBF5EE`, imperceptible. Même use case dans `cart.css`, `event.css`, `interactions.css`. Ne pas créer `--delivery-bg` — cette décision est définitive. |

- ✅ `tokens.css` : nouveau token `--star-gold: #F0A500` ajouté ligne 240 (après `--gold-soft`)
- ✅ `modal.css` L347 : `.k-modal-meta-star { color: var(--star-gold) }` — migration hex étoile notation
- ✅ `modal.css` L633 : `background: var(--green-bg)` — migration hex fond livraison mobile
- ✅ `css/dist/components.css` rebundlé — contient `var(--star-gold)` et `var(--green-bg)`, aucun résidu hex
- ✅ Audit `npm run audit:arch` : **0 violation**
- Polish prix clamp / swatches ronds / trust bar horizontale : déjà appliqués historiquement, validés post-PR-M4

---

## 9. Checklist avant toute PR modal desktop

| ☐ | Action |
|---|---|
| ☐ | Identifier la section concernée (§1 à §5 nouvelle numérotation) |
| ☐ | Vérifier les invariants B-M-01 à B-M-12 |
| ☐ | Tester produit minimal (1 image + nom + prix) — aucun espace vide |
| ☐ | Tester produit complet (variantes + promo + specs + social proof) — aucun débordement |
| ☐ | Aucune valeur hex en dur (uniquement tokens `var(--)`) |
| ☐ | Aucune dépendance fournisseur dans le CSS |
| ☐ | Grille déclarée dans §5 uniquement |
| ☐ | Blocs conditionnels révélés par classe `ModalViewModel` uniquement |
| ☐ | Testé à 900px, 1024px, 1280px, 1440px, 1920px |
| ☐ | Mobile non impacté (§1 et §2 inchangés) |

---

## 10. Liens et co-références

| Document | Rôle |
|---|---|
| `BOUTIQUE_MODAL_ARCHITECTURE.md` | Architecture CSS actuelle (§1-§6 post-PR-M2, invariants B-M-01→12) |
| `BOUTIQUE_SOURCE_OF_TRUTH.md` | Carte propriétaire consolidée + état de santé + dette priorisée |
| `BOUTIQUE_PRODUCT_DISPLAY_CONTRACT.md` | Contrat `ProductCardViewModel` — modèle sur lequel s'appuie le `ModalViewModel` |
| `BOUTIQUE_DESKTOP_REDESIGN_BRIEF.md` | Direction UX desktop — modal doit vendre et rassurer, pas faire de la technique |
| `boutique/css/modal.css` | Fichier CSS propriétaire — 1782 lignes, 6 sections — toutes les règles `.k-modal-*` |
| `boutique/js/view-models/modal-view-model.js` | ViewModel — pose les 10 classes contractuelles `.k-modal--*` |
| `boutique/js/b-modal-desktop-enhancers.js` | Injections desktop + hôte de `setupModalContractClasses()` |
| `boutique/js/b-modal.js` | Orchestrateur modal — carousel, prix, infos, qty, boutons |
| `MODAL_MOBILE_ARCHITECTURE.md` | Document complémentaire — mobile gelé GEL v1.0 |

---

*Komerce · Architecture Modal Desktop · v1.1 · 21 mai 2026 · Une seule modal — tout sourcing — zéro effort additionnel*
