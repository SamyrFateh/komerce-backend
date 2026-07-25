# Architecture du modal produit Boutique

> **Statut** : doc d'architecture du fichier `boutique/css/modal.css`
> **Date** : 21 mai 2026 (post-PR-M2 + PR-M5)
> **Owner** : `boutique/css/modal.css` (1782 lignes, **6 sections** depuis PR-M2)
> **Co-owner** : `boutique/js/view-models/modal-view-model.js` pour les classes contractuelles `.k-modal--*` (cf. `MODAL_DESKTOP_ARCHITECTURE.md` §3)
> **JS associé** : `boutique/js/b-modal.js` + `boutique/js/b-modal-desktop-enhancers.js`
> **HTML cible** : `boutique/index.html` lignes 290-358 (structure DOM)

---

## 1. Pourquoi cette doc existe

Le fichier `modal.css` fait 1782 lignes, traverse 6 sections (§1 à §6), 2 breakpoints majeurs (`< 900px` mobile / `≥ 900px` desktop).

Sans plan d'ensemble :

- un agent qui veut corriger un problème touche la **mauvaise** section et se fait écraser par une autre (cascade)
- une PR ajoute des règles partout au lieu d'utiliser la section propriétaire
- des invariants présents dans le code (mentionnés en commentaires `Règle I-3`, `Règle I-5`, `B-M-11`) ne sont nulle part dans la doc générale

Cette mini-doc complète `BOUTIQUE_ARCHITECTURE.md` en remplissant le trou : **`modal.css` est désormais déclaré co-owner avec `modal-view-model.js`** dans le tableau d'ownership de `BOUTIQUE_ARCHITECTURE.md` §3 (post-PR-M1).

---

## 2. Règle d'or du fichier

**Inscrite en commentaire dans le code, lignes 1 à 25** :

- Toute règle mobile = base (sans media query) ou `@media (max-width: 899px)`
- Toute règle desktop = `@media (min-width: 900px)`
- **JAMAIS de tablet middle ground** `@media (min-width: 600px)` sans borne supérieure (sinon ça déborde sur desktop)
- Le `@media (max-width: 899px)` à haute spécificité (`#k-modal`) doit **toujours répéter** `flex: 1` et `min-height: 0`, sinon il écrase la base avec un vide
- **`grid-template-columns` sur `.k-modal-product-zone` : §6 UNIQUEMENT** (invariant B-M-11)

---

## 3. Carte des 6 sections (post-PR-M2)

| § | Lignes approx. | Rôle | Media query |
|---|---|---|---|
| **§1 Base mobile** | 27-670 | Tout le mobile : overlay, shell, topbar, scroll owner, image, infos, actions sticky bas, suggestions, livraison/trust mobile minimal | Aucune (base) |
| **§2 Mobile guard** | 672-744 | Haute spécificité `#k-modal` pour contrer les conflits, force `flex:1` et `min-height:0` | `(max-width: 899px)` |
| **§3 Desktop ≥900px** | 746-978 | **Typographie, espacement, topbar, actions desktop — PAS DE GRILLE** (la grille vit dans §6) | `(min-width: 900px)` |
| **§4 Variantes** | 980-1373 | SKUs couleur, grille tailles/pointures, guide des tailles overlay (sans media query — composant pur) | Aucune |
| **§5 Zones desktop enrichies** | 1375-1666 | Blocs `.k-modal-aed-price`, `.k-modal-flash-bar`, `.k-modal-stock-bar`, `.k-modal-delivery`, `.k-modal-payment`. **Masqués par défaut, révélés ≥ 900px**. ⚠️ Actuellement révélés inconditionnellement par `@media` — devrait être révélés par classes `ModalViewModel` (PR-M3 à faire). | `(min-width: 900px)` |
| **§6 Layout desktop** | 1667-fin | **Source de vérité unique pour `grid-template-columns`** (43/57), pleine page 100dvh, image sticky col gauche, details scroll, actions sticky bas. Contient 1 override `(900-1120)` pour ajuster grid à 44/56 et padding. | `(min-width: 900px)` + 1 override sous-borne |

**Sections supprimées en PR-M2** :
- Ancien §4 (Desktop intermédiaire 900-1120 — grille indépendante) → absorbé dans §6 comme override sous-borne
- Ancien §5 (Desktop large ≥1200 — grille indépendante) → absorbé dans §6 via `clamp()` et minmax
- Ancien §7 (Full page Temu) → promu au rang de §6, devient la source unique de grille

**Section renommée** :
- Ancien §6 (Zones desktop enrichies) → renumérotée §5

---

## 4. Ordre de cascade — qui gagne sur qui

Cette compréhension est **critique** pour éviter les dérives. Sur un viewport donné, plusieurs sections peuvent matcher en cascade.

### Mobile (< 900px)

```
§1 base mobile (sans MQ) — POSE LA BASE
   ↓
§2 mobile guard (max-width: 899px, spécificité #k-modal) — RENFORCE
   ↓
§5 zones enrichies (display:none par défaut sur base mobile) — MASQUE
```

### Desktop ≥ 900px

```
§1 base mobile (sans MQ) — POSE LES VALEURS PAR DÉFAUT
   ↓
§3 desktop (min-width: 900px) — TYPO, ESPACEMENT, TOPBAR (PAS de grid)
   ↓
§5 zones enrichies (min-width: 900px) — RÉVÈLE LES BLOCS DESKTOP
   ↓
§6 layout desktop (min-width: 900px) — POSE LA GRILLE 43/57
   ↓ (sur 900-1120 uniquement)
§6 override (900-1120) — AJUSTE grid à 44/56 + padding clamp 18-32
```

**Plus simple qu'avant PR-M2** : la chaîne d'overrides est linéaire, plus de "§7 ré-écrit §4". §6 est unique source de grille.

---

## 5. Invariants

Tirés du code (commentaires lignes 1-25, mobile guard §2, header §6), formalisés ici. **12 invariants au total** (8 originaux + 4 ajoutés par `MODAL_DESKTOP_ARCHITECTURE.md` PR-M2).

| ID | Invariant | Vérification |
|---|---|---|
| **B-M-01** | Toute règle mobile dans base ou `@media (max-width: 899px)` | Pas de règle `.k-modal-*` sans média entre §3 et §6 |
| **B-M-02** | Toute règle desktop dans `@media (min-width: 900px)` minimum | grep `.k-modal-` dans base et vérifier que c'est mobile-only |
| **B-M-03** | Aucune media query `(min-width: 600px)` sans borne supérieure | grep `min-width: 6` dans le fichier doit retourner 0 sur les sélecteurs `.k-modal-*` |
| **B-M-04** | Le mobile guard (§2) répète `flex: 1` et `min-height: 0` sur `#k-modal .k-modal-scroll` | sinon override par spécificité ID écrase avec un vide |
| **B-M-05** | Aucun hex en dur — uniquement des tokens CSS de `tokens.css` (`var(--coral)`, `var(--sand)`...) | `npm run audit:arch` — **0 violation** ✅ (PR-M4 livrée 21/05, 2 hex migrés) |
| **B-M-06** | Les zones enrichies §5 sont `display: none` par défaut, révélées ≥ 900px | inspection visuelle mobile |
| **B-M-07** | `.k-modal-product-zone` est `display: contents` sur mobile, `grid` desktop. Toujours les deux. | check §1 ligne ~118 + §6 |
| **B-M-08** | La grid desktop a `minmax(0, X%)` pas `X%` direct (sinon overflow horizontal des enfants) | check toutes les `grid-template-columns` dans §6 |
| **B-M-09** | Aucune règle CSS ne dépend d'un fournisseur ou d'une source de données | `grep "dubai\|whatsapp\|csv\|excel"` dans `modal.css` → 0 résultat (sauf `var(--whatsapp)` couleur de marque, autorisé) |
| **B-M-10** | Chaque bloc conditionnel est `display:none` par défaut, révélé par classe `.k-modal--*` sur `.k-modal` uniquement | ⚠️ **Non respecté actuellement** — PR-M3 à faire. Aujourd'hui les blocs sont révélés par `@media (min-width:900px)` inconditionnel |
| **B-M-11** | La grille desktop est déclarée **une seule fois dans §6**, jamais ailleurs | `grep "grid-template-columns" css/modal.css` → uniquement dans §6 |
| **B-M-12** | Un produit minimal (1 image + nom + prix) s'affiche sans espace vide ni layout cassé | Test intégration avec `ModalViewModel` minimal — dépend de B-M-10 |

> **⚠️ Invariant B-M-10 non respecté** : à ce jour (21/05/2026) le CSS ne lit qu'une seule classe contractuelle (`.k-modal--has-promo`). Les 9 autres classes posées par `ModalViewModel` sont ignorées. PR-M3 doit corriger ça pour réaliser l'objectif "modale dynamique qui s'adapte à son contenu".

---

## 6. Zone d'impact — qui dépend de quoi

### Sélecteurs propriétaires du fichier

`modal.css` est **propriétaire exclusif** de tous les sélecteurs `.k-modal-*` :

```
.k-modal, .k-modal-overlay, .k-modal-topbar, .k-modal-back, .k-modal-nav-btn,
.k-modal-cart-btn, .k-modal-close, .k-modal-scroll, .k-modal-product-zone,
.k-modal-img-wrap, .k-modal-carousel, .k-modal-carousel-track, .k-modal-slide,
.k-modal-dots, .k-modal-dot, .k-modal-thumbs, .k-modal-thumb, .k-modal-counter,
.k-modal-fav-btn, .k-modal-fullscreen, .k-modal-details, .k-modal-promo-badge,
.k-modal-info, .k-modal-desc, .k-modal-price-row, .k-modal-price,
.k-modal-old-price, .k-modal-meta,
.k-modal-actions, .k-modal-subtotal, .k-modal-topbar-product, .k-modal-share-row,
.k-modal-share-btn, .k-modal-specs, .k-modal-spec-*, .k-modal-trust,
.k-modal-suggestions, .k-modal-aed-*, .k-modal-flash-bar, .k-modal-stock-bar,
.k-modal-delivery, .k-modal-delivery-opt, .k-modal-payment, .k-modal-payment-opt,
.k-modal-pay-*, .k-modal-section-title, .k-modal-opt-radio, .k-modal-variants,
.k-modal-breadcrumb, .k-modal-zoom-preview, .k-modal-zoom-lens
```

Plus les variantes `.k-vg`, `.k-vg-skus`, `.k-vg-sizes`, `.k-sku`, `.k-vp` (dans §4 post-PR-M2).

**Interdiction stricte** : aucun de ces sélecteurs ne doit avoir de règle hors de `modal.css`. Si un autre fichier CSS a une règle `.k-modal-*`, c'est un bug à corriger (consolidation dans modal.css).

### Fichiers qui injectent du contenu dans le modal

| Fichier | Rôle | Injecte quoi |
|---|---|---|
| `b-modal.js` | Orchestrateur principal | Carousel, dots, thumbs, prix, infos, qty, boutons add/buy |
| `b-modal-desktop-enhancers.js` | Enrichissements desktop (≥ 900px uniquement) | Breadcrumb topbar, zones AED/flash/stock, livraison, paiement, partage, accordéon specs, lentille zoom |

**Règle** : si une nouvelle classe `.k-modal-*` est injectée par JS, son CSS doit aller **dans modal.css**, pas ailleurs. C'est la zone d'impact.

---

## 7. Pièges connus

### Piège 1 — Conteneurs flex column qui ne s'étirent pas

**Symptôme** : sur desktop, le contenu d'une section paraît trop étroit dans une colonne large.

**Cause** : `.k-modal-info` est `flex-direction: column`. Ses enfants ne s'étirent **horizontalement** que si la valeur par défaut `align-items: stretch` est respectée ET si chaque conteneur enfant flex-column a une `width: 100%` explicite.

**Sous-conteneurs concernés** : `.k-modal-delivery-opts`, `.k-modal-payment-opts`, et possiblement les blocs injectés par `b-modal-desktop-enhancers.js`.

**Patch type** :
```css
@media (min-width: 900px) {
  #k-modal .k-modal-product-zone .k-modal-info,
  #k-modal .k-modal-product-zone .k-modal-info > *,
  #k-modal .k-modal-product-zone .k-modal-delivery-opts,
  #k-modal .k-modal-product-zone .k-modal-payment-opts {
    width: 100%;
  }
}
```

### Piège 2 — `position: sticky` qui ne colle pas

**Symptôme** : sur mobile, la barre d'actions `.k-modal-actions` reste dans le flux scrollable au lieu de se coller en bas.

**Cause** : `position: sticky` ne fonctionne pas dans un `overflow-y: auto` flex container quand l'élément n'est pas en `flex-shrink: 0`.

**Solution déjà appliquée** (§1 + §2 ligne 459-481) : `position: fixed` en mobile, avec `padding-bottom` compensatoire sur `.k-modal-scroll` pour que le contenu ne disparaisse pas derrière.

### Piège 3 — Topbar mobile qui colle la croix au bord

**Symptôme** : sur petit mobile, le bouton X du topbar dépasse ou est collé au bord.

**Cause** : `.k-modal-cart-btn .k-cart-avatar` était à 52px (poussait la croix hors écran).

**Solution déjà appliquée** (ligne 81) : valeur réduite à 36px (mobile) / 44px (desktop ligne 690).

### Piège 4 — `display: contents` qui casse l'ordre flex sur mobile

**Symptôme** : sur mobile, les enfants du modal apparaissent dans un ordre inattendu.

**Cause** : `.k-modal-product-zone` est `display: contents` sur mobile. Les enfants `img-wrap`, `details`, `actions`, `suggestions` participent directement au flex de `.k-modal-scroll`. Sans `order` explicite, ils sortent dans l'ordre DOM.

**Solution déjà appliquée** (lignes 459-481) : `.k-modal-actions { order: 3; }`, `.k-modal-suggestions { order: 2; }`.

### Piège 5 — Backdrop-filter inopérant sur Samsung Internet

**Symptôme** : la barre d'actions sticky laisse voir le contenu derrière sur Samsung et Chrome Android ancien.

**Cause** : `backdrop-filter` est déclaré supporté mais non rendu sur ces navigateurs en position sticky.

**Solution actuelle (post-PR-M5)** : fond opaque `var(--white)` sur mobile via `#k-modal .k-modal-actions` (spécificité ID suffisante, plus besoin de `!important`), glass effect réservé au desktop. Voir bloc `@media (max-width: 899px)` autour de la ligne 500.

---

## 8. Checklist avant PR qui touche modal.css

À cocher avant tout commit qui modifie `modal.css` :

- [ ] J'ai identifié la **section** concernée (§1 à §6 post-PR-M2)
- [ ] J'ai vérifié que ma modification ne **traverse pas** les invariants B-M-01 à B-M-12
- [ ] Si je touche une règle mobile, j'ai vérifié qu'elle n'est **pas écrasée** par §2 mobile guard
- [ ] Si je touche une règle desktop, j'ai vérifié qu'elle n'est **pas écrasée** par §6 layout (qui pose la grille unique)
- [ ] Si je touche la grille `.k-modal-product-zone`, j'ai vérifié que c'est dans §6 **uniquement** (B-M-11)
- [ ] J'ai testé sur **les 3 plages desktop** : 900-1120px, 1120-1199px, ≥1200px
- [ ] J'ai testé sur **les 2 plages mobile** : ≤599px, 600-899px
- [ ] Aucune valeur hex en dur (uniquement des tokens `var(--...)`)
- [ ] Aucune media query `(min-width: 600px)` sans borne supérieure
- [ ] Aucun nouvel `!important` ajouté (cible : 2 légitimes existants, voir §3 ligne 363 et 602)
- [ ] Si j'ajoute une nouvelle classe `.k-modal-*`, je l'ai documentée dans §6 zone d'impact ci-dessus
- [ ] Si je veux qu'un bloc dépende d'un état produit, j'utilise une classe `.k-modal--*` posée par `ModalViewModel` (cf. `MODAL_DESKTOP_ARCHITECTURE.md` §3), **pas** une media query ni un attribut HTML
- [ ] Si l'enrichissement vient du JS (`b-modal-desktop-enhancers.js`), j'ai mis à jour ce fichier aussi

---

## 9. Quand toucher quelle section (post-PR-M2 — 6 sections)

| Tu veux modifier... | Tu touches... |
|---|---|
| Carousel image, thumbs, fullscreen | §1 (mobile) + §3 (desktop typo/espacement) |
| Topbar (back, breadcrumb, cart, close) | §1 + §3 + JS breadcrumb dans `b-modal-desktop-enhancers.js` |
| **Layout grid principal desktop** | **§6 uniquement** (B-M-11) |
| Padding détails desktop | §3 (typo) + §6 (layout) |
| Barre d'actions (qty, add, buy) | §1 mobile (sticky bas) + §3 desktop + §6 si position dans la grille |
| Suggestions "Vous aimerez aussi" | §1 (mobile) + §3 (desktop) |
| Variant picker (couleur / taille) | §4 |
| Guide des tailles overlay | §4 (intégré au composant variantes depuis PR-M2) |
| Blocs livraison, paiement, AED, flash, stock | §5 (révélés ≥ 900px — à terme par classe `ModalViewModel`, cf. PR-M3) |
| Mode plein écran (footer masqué, full viewport) | §6 |
| **Bloc qui dépend d'un état produit (promo, variantes, stock, etc.)** | Ajouter règle dans §5 avec sélecteur `.k-modal--has-X` (PR-M3) |

---

## 10. Liens et co-référence

- `docs/BOUTIQUE_ARCHITECTURE.md` — règles générales Boutique (modal.css co-owner avec ModalViewModel)
- `docs/MODAL_DESKTOP_ARCHITECTURE.md` — plan de migration desktop, 10 classes contractuelles, invariants B-M-09→12
- `docs/MODAL_MOBILE_ARCHITECTURE.md` — mobile gelé GEL v1.0 (13 invariants M-MOB-01→13)
- `docs/BOUTIQUE_SOURCE_OF_TRUTH.md` — carte propriétaire consolidée, état de santé, dette
- `boutique/js/view-models/modal-view-model.js` — pose les 10 classes contractuelles sur `.k-modal`
- `boutique/js/b-modal.js` — orchestrateur JS du modal
- `boutique/js/b-modal-desktop-enhancers.js` — enrichissements desktop + branchement ViewModel
- `boutique/index.html` lignes 290-358 — structure DOM cible
- `boutique/css/tokens.css` — variables CSS sources de vérité couleur/spacing

---

## 11. Évolution de la doc

Si tu ajoutes une section §7 dans `modal.css`, **mets cette doc à jour** dans la même PR. Sinon le prochain agent n'aura pas la carte.

---

*Komerce · Architecture modal.css · 6 sections post-PR-M2 · 21 mai 2026*
