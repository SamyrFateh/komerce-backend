# Architecture du modal produit Boutique

> **Statut** : doc d'architecture du fichier `boutique/css/modal.css`
> **Date** : 17 mai 2026
> **Owner** : `boutique/css/modal.css` (1719 lignes, 7 sections + sous-sections)
> **JS associé** : `boutique/js/b-modal.js` + `boutique/js/b-modal-desktop-enhancers.js`
> **HTML cible** : `boutique/index.html` lignes 290-358 (structure DOM)

---

## 1. Pourquoi cette doc existe

Le fichier `modal.css` fait 1719 lignes, traverse 7 sections (§1 à §7), 2 breakpoints majeurs (`< 900px` mobile / `≥ 900px` desktop) et 3 plages desktop spécifiques (base, 900-1120, ≥1200).

Sans plan d'ensemble :

- un agent qui veut corriger un problème touche la **mauvaise** section et se fait écraser par une autre (cascade)
- une PR ajoute des règles partout au lieu d'utiliser la section propriétaire
- des invariants présents dans le code (mentionnés en commentaires `Règle I-3`, `Règle I-5`) ne sont nulle part dans la doc générale

Cette mini-doc complète `BOUTIQUE_ARCHITECTURE.md` en remplissant le trou : **`modal.css` n'a pas d'owner déclaré dans le tableau** (seul `b-modal.js` y figure). À corriger en ajoutant la ligne :

```
| Modal produit CSS | boutique/css/modal.css |
```

---

## 2. Règle d'or du fichier

**Inscrit en commentaire dans le code, lignes 1 à 14** :

- Toute règle mobile = base (sans media query) ou `@media (max-width: 899px)`
- Toute règle desktop = `@media (min-width: 900px)`
- **JAMAIS de tablet middle ground** `@media (min-width: 600px)` sans borne supérieure (sinon ça déborde sur desktop)
- Le `@media (max-width: 899px)` à haute spécificité (`#k-modal`) doit **toujours répéter** `flex: 1` et `min-height: 0`, sinon il écrase la base avec un vide

---

## 3. Carte des 7 sections

| § | Lignes | Rôle | Media query |
|---|---|---|---|
| **§1 Base mobile** | 17-587 | Tout le mobile : overlay, shell, topbar, scroll owner, image, infos, recherche, actions sticky bas, suggestions | Aucune (base) |
| **§2 Mobile guard** | 588-659 | Haute spécificité `#k-modal` pour contrer les conflits, force `flex:1` et `min-height:0` | `(max-width: 899px)` |
| **§3 Desktop base** | 662-887 | **Source de vérité unique desktop** : grid 52/48, image sticky col gauche, détails col droite, actions sticky bas col droite, suggestions sous product-zone | `(min-width: 900px)` |
| **§4 Desktop intermédiaire** | 889-904 | Ajustements 900-1120px : grid passe 46/54, padding détails 18px, actions stack vertical (Acheter pleine largeur en row 2) | `(min-width: 900px) and (max-width: 1120px)` |
| **§5 Desktop large** | 907-920 | Ajustements ≥1200px : grid 46/54 avec colonne droite min 400px, suggestions auto-fill 200px+ | `(min-width: 1200px)` |
| **§6 Zones desktop enrichies** | 1311-1606 | Blocs `.k-modal-aed-price`, `.k-modal-flash-bar`, `.k-modal-stock-bar`, `.k-modal-delivery`, `.k-modal-payment` injectés par `b-modal-desktop-enhancers.js`. **Masqués par défaut, révélés ≥ 900px**. | `(min-width: 900px)` |
| **§7 Full page Temu-style** | 1609-1719 | Pleine page (100vw × 100dvh) : footer masqué, overlay blanc, **grid override 43/57**, padding clamp(24px, 4vw, 64px), 2 overrides pour 900-1120 et ≥1200 | `(min-width: 900px)` + overrides |

**Sous-sections transverses** :
- Lignes 924-1091 : **Variantes** (SKUs couleur, grille tailles/pointures) — pas dans la numérotation §
- Lignes 1092-1308 : **Guide des tailles overlay** — pas dans la numérotation §

---

## 4. Ordre de cascade — qui gagne sur qui

Cette compréhension est **critique** pour éviter les dérives. Sur un viewport donné, plusieurs sections peuvent matcher en cascade. Voici qui gagne.

### Mobile (< 900px)

```
§1 base mobile (sans MQ) — POSE LA BASE
   ↓
§2 mobile guard (max-width: 899px, spécificité #k-modal) — RENFORCE
   ↓
§6 zones enrichies (display:none par défaut, base mobile) — MASQUE
```

### Desktop 900-1120px

```
§1 base mobile (sans MQ) — POSE LES VALEURS PAR DÉFAUT
   ↓
§3 desktop base (min-width: 900px) — OVERRIDE COMPLET POUR DESKTOP
   ↓
§4 desktop intermédiaire (900-1120) — AJUSTE LA GRID 46/54
   ↓
§6 zones enrichies (min-width: 900px) — RÉVÈLE LES BLOCS DESKTOP
   ↓
§7 v3 full page (min-width: 900px) — RÉ-OVERRIDE GRID 43/57 + padding clamp
   ↓
§7 override 900-1120 — RE-AJUSTE GRID 44/56 et padding clamp 18-32
```

**À noter** : §7 ré-écrit ce que §4 vient de faire. C'est intentionnel (§7 = mode plein écran activé), mais la chaîne d'overrides est fragile.

### Desktop ≥1200px

```
§1 base
   ↓
§3 desktop base — grid 52/48
   ↓
§5 desktop large — grid 46/54 (min 400px)
   ↓
§6 zones enrichies
   ↓
§7 v3 full page — grid 43/57 + padding clamp jusqu'à 64px
   ↓
§7 override ≥1200 — grid 43/57 confirmé
```

**Conséquence pratique** : la grid finale **est toujours celle de §7** sur les viewports ≥ 900px (en mode full page activé). §3, §4, §5 sont écrasés mais restent **utilisés pour les autres propriétés** (padding intermédiaire, layout actions, etc.).

---

## 5. Invariants

Tirés du code (commentaires lignes 1-14, 588-592, 1313-1316), formalisés ici :

| ID | Invariant | Vérification |
|---|---|---|
| **B-M-01** | Toute règle mobile dans base ou `@media (max-width: 899px)` | Pas de règle `.k-modal-*` sans média entre § 3 et § 7 |
| **B-M-02** | Toute règle desktop dans `@media (min-width: 900px)` minimum | grep `.k-modal-` dans base et vérifier que c'est mobile-only |
| **B-M-03** | Aucune media query `(min-width: 600px)` sans borne supérieure | grep `min-width: 6` dans le fichier doit retourner 0 |
| **B-M-04** | Le mobile guard (§2) répète `flex: 1` et `min-height: 0` sur `#k-modal .k-modal-scroll` | sinon override par spécificité ID écrase avec un vide |
| **B-M-05** | Aucun hex en dur — uniquement des tokens CSS de `tokens.css` (`var(--coral)`, `var(--sand)`...) | grep `#[0-9a-fA-F]{3,6}` dans le fichier |
| **B-M-06** | Les zones enrichies §6 sont `display: none` par défaut, révélées uniquement ≥ 900px | inspection visuelle mobile |
| **B-M-07** | `.k-modal-product-zone` est `display: contents` sur mobile, `grid` desktop. Toujours les deux. | check §1 ligne 111-113 + §3 ligne 709-717 |
| **B-M-08** | La grid desktop a `minmax(0, X%)` pas `X%` direct (sinon overflow horizontal des enfants) | check toutes les `grid-template-columns` |

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
.k-modal-old-price, .k-modal-meta, .k-modal-inner-search, .k-modal-search-*,
.k-modal-actions, .k-modal-subtotal, .k-modal-topbar-product, .k-modal-share-row,
.k-modal-share-btn, .k-modal-specs, .k-modal-spec-*, .k-modal-trust,
.k-modal-suggestions, .k-modal-aed-*, .k-modal-flash-bar, .k-modal-stock-bar,
.k-modal-delivery, .k-modal-delivery-opt, .k-modal-payment, .k-modal-payment-opt,
.k-modal-pay-*, .k-modal-section-title, .k-modal-opt-radio, .k-modal-variants,
.k-modal-breadcrumb, .k-modal-zoom-preview, .k-modal-zoom-lens
```

Plus les variantes `.k-vg`, `.k-vg-skus`, `.k-vg-sizes`, `.k-sku`, `.k-vp` (lignes 924-1091).

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

**Solution déjà appliquée** (lignes 432-456) : fond opaque `var(--white) !important` sur mobile, glass effect réservé au desktop.

---

## 8. Checklist avant PR qui touche modal.css

À cocher avant tout commit qui modifie `modal.css` :

- [ ] J'ai identifié la **section** concernée (§1 à §7, ou variantes 924-1091, ou guide tailles 1092-1310)
- [ ] J'ai vérifié que ma modification ne **traverse pas** les invariants B-M-01 à B-M-08
- [ ] Si je touche une règle mobile, j'ai vérifié qu'elle n'est **pas écrasée** par §2 mobile guard
- [ ] Si je touche une règle desktop, j'ai vérifié qu'elle n'est **pas écrasée** par §4, §5 ou §7 sur le viewport cible
- [ ] J'ai testé sur **les 3 plages desktop** : 900-1120px, 1120-1199px, ≥1200px
- [ ] J'ai testé sur **les 2 plages mobile** : ≤599px, 600-899px
- [ ] Aucune valeur hex en dur (uniquement des tokens `var(--...)`)
- [ ] Aucune media query `(min-width: 600px)` sans borne supérieure
- [ ] Si j'ajoute une nouvelle classe `.k-modal-*`, je l'ai documentée dans §6 zone d'impact ci-dessus
- [ ] Si l'enrichissement vient du JS (`b-modal-desktop-enhancers.js`), j'ai mis à jour ce fichier aussi

---

## 9. Quand toucher quelle section

| Tu veux modifier... | Tu touches... |
|---|---|
| Carousel image, thumbs, fullscreen | §1 lignes 115-272 (mobile) + §3 lignes 719-765 (desktop) |
| Topbar (back, breadcrumb, search, cart, close) | §1 lignes 44-95 + §3 lignes 686-698 + JS breadcrumb |
| Layout grid principal | §3 ligne 709 (base) puis §4 §5 §7 selon viewport |
| Padding détails | §3 ligne 768-772 + §4 ligne 899 + §7 lignes 1672-1674 + override 900-1120 ligne 1698 |
| Barre d'actions (qty, add, buy) | §1 lignes 414-491 (mobile sticky bas) + §3 lignes 819-836 (desktop) + §7 lignes 1677-1682 |
| Suggestions "Vous aimerez aussi" | §1 lignes 507-587 (mobile) + §3 lignes 850-872 (desktop) |
| Variant picker (couleur / taille) | Lignes 924-1091 (hors numérotation §) |
| Guide des tailles overlay | Lignes 1092-1308 (hors numérotation §) |
| Blocs livraison, paiement, AED, flash, stock | §6 lignes 1311-1606 (révélés ≥ 900px) |
| Mode plein écran (footer masqué, full viewport) | §7 lignes 1609-1719 |

---

## 10. Liens et co-référence

- `docs/BOUTIQUE_ARCHITECTURE.md` — règles générales Boutique (cette doc complète le tableau d'ownership)
- `boutique/js/b-modal.js` — orchestrateur JS du modal
- `boutique/js/b-modal-desktop-enhancers.js` — enrichissements desktop
- `boutique/index.html` lignes 290-358 — structure DOM cible
- `boutique/css/tokens.css` — variables CSS sources de vérité couleur/spacing
- `AGENTS.md` §4 "Règle Boutique obligatoire" — checklist avant PR Boutique

---

## 11. Évolution de la doc

Si tu ajoutes une section §8 dans `modal.css`, **mets cette doc à jour** dans la même PR. Sinon le prochain agent n'aura pas la carte. Cf. règle de mise à jour `AGENTS.md` §3.
