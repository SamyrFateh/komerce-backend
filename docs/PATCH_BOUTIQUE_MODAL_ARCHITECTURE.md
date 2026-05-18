# Patchs pour BOUTIQUE_MODAL_ARCHITECTURE.md

> Date : 18 mai 2026 — lot CSS-4
> But : corriger les 2 erreurs identifiées dans l'audit du 18/05 (pipeline source/dist + multi-owners)

---

## Patch 1 — Insérer une nouvelle §0 EN TÊTE du document

Insérer juste après l'en-tête (entre "> JS associé..." et "## 1. Pourquoi cette doc existe") :

```markdown
---

## 0. Pré-requis OBLIGATOIRE — pipeline source/dist

**`modal.css` N'EST PAS chargé directement en production.**

Le pipeline CSS Boutique fonctionne ainsi :

```
modal.css (source)  →  bundle-css.js (concat)  →  dist/components.css  →  prod
```

L'index.html charge **uniquement** :
- `dist/base.css`
- `dist/components.css` ← contient `modal.css`
- `dist/desktop.css` ← contient certaines règles `.k-modal-*` desktop-only
- `dist/event.css`

**Conséquence pratique** : toute modification de `modal.css` doit être suivie de :

```bash
cd public/boutique && npm run bundle:css
```

Sinon la modification n'a aucun effet en prod.

Voir `docs/BOUTIQUE_CSS_PIPELINE.md` pour le pipeline complet et la liste des sources de chaque bundle.

---
```

---

## Patch 2 — Remplacer la §6 "Zone d'impact" intégralement

Remplacer la section §6 actuelle par cette version corrigée :

```markdown
## 6. Zone d'impact — qui dépend de quoi

### Le modal a TROIS sources contribuant aux `.k-modal-*`

Contrairement à ce qu'affirmait la v1 de cette doc, `modal.css` n'est PAS propriétaire exclusif. Trois sources contribuent intentionnellement :

| Source | Périmètre `.k-modal-*` | Bundle cible |
|---|---|---|
| `modal.css` | Base + mobile + desktop core (95% des règles) | `dist/components.css` |
| `boutique-desktop.css` (lignes 239-246, 326-400) | Carousel zoom hover, `.k-modal-recent-*`, `.k-modal-keyboard-hint` | `dist/desktop.css` |
| `desktop-commerce-skeleton.css` (lignes 294-306) | `.k-modal-img-wrap` hover desktop | `dist/desktop.css` |

### Règle d'or

Si tu ajoutes une règle `.k-modal-*` qui s'applique uniquement en desktop ET concerne le carousel zoom, les suggestions récentes ou le hint clavier, elle va dans `boutique-desktop.css`. Sinon, dans `modal.css`.

Si tu doutes : `modal.css` est le défaut. La répartition multi-source est une exception documentée.

### Sélecteurs propriétaires de `modal.css`

Tous les sélecteurs ci-dessous appartiennent à `modal.css` (et donc à `dist/components.css`) :

```
.k-modal, .k-modal-overlay, .k-modal-topbar, .k-modal-back, .k-modal-nav-btn,
.k-modal-cart-btn, .k-modal-close, .k-modal-scroll, .k-modal-product-zone,
.k-modal-img-wrap (sauf hover desktop → desktop-commerce-skeleton),
.k-modal-carousel, .k-modal-carousel-track, .k-modal-slide,
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

Plus les variantes `.k-vg`, `.k-vg-skus`, `.k-vg-sizes`, `.k-sku`, `.k-vp` (lignes 924-1091 de modal.css).

### Sélecteurs propriétaires de `boutique-desktop.css` (.k-modal-* desktop-only)

```
#k-modal .k-modal-carousel { cursor: zoom-in; }
#k-modal .k-modal-slide
#k-modal .k-modal-carousel:hover .k-modal-carousel-track
.k-modal-slide:not(.is-hidden)
.k-modal-recent
.k-modal-recent-title
.k-modal-recent-grid
.k-modal-recent-card (+ :hover)
.k-modal-recent-img (+ img)
.k-modal-recent-name
.k-modal-recent-price
.k-modal-keyboard-hint
```

### Sélecteurs propriétaires de `desktop-commerce-skeleton.css`

```
.k-modal (background override desktop)
.k-modal-img-wrap (hover effect)
.k-modal-img-wrap:hover .k-modal-slide
.k-modal-img-wrap:hover #k-modal-img
```

### Interdiction stricte

Aucun sélecteur `.k-modal-*` ne doit avoir de règle dans un fichier hors des 3 sources ci-dessus. Si un autre fichier CSS a une règle `.k-modal-*`, c'est un bug à corriger (consolidation dans l'owner approprié).

### Fichiers qui injectent du contenu dans le modal

| Fichier | Rôle | Injecte quoi |
|---|---|---|
| `b-modal.js` | Orchestrateur principal | Carousel, dots, thumbs, prix, infos, qty, boutons add/buy |
| `b-modal-desktop-enhancers.js` | Enrichissements desktop (≥ 900px uniquement) | Breadcrumb topbar, zones AED/flash/stock, livraison, paiement, partage, accordéon specs, lentille zoom |

**Règle** : si une nouvelle classe `.k-modal-*` est injectée par JS, son CSS doit aller :
- **Par défaut** dans `modal.css` (bundle components)
- **Si desktop-only et lié au carousel zoom / recent grid / keyboard** : dans `boutique-desktop.css` (bundle desktop)
- **Si lié à l'image hover spécifique skeleton** : dans `desktop-commerce-skeleton.css` (bundle desktop)
```

---

## Patch 3 — Ajouter à la §8 "Checklist avant PR"

Ajouter ces 2 cases à la fin de la checklist § 8 :

```markdown
- [ ] J'ai lancé `npm run bundle:css` après mes modifs (sinon rien n'est en prod)
- [ ] J'ai vérifié que mon sélecteur va dans le bon owner (cf. §6) : modal.css / boutique-desktop.css / desktop-commerce-skeleton.css
```

---

## Comment appliquer ces 3 patches

Dans le repo, ouvrir `docs/BOUTIQUE_MODAL_ARCHITECTURE.md` et :

1. Insérer le contenu du Patch 1 juste après l'en-tête, avant `## 1. Pourquoi cette doc existe`
2. Remplacer entièrement la section `## 6. Zone d'impact — qui dépend de quoi` par le Patch 2
3. Ajouter les 2 cases du Patch 3 à la fin de la checklist `## 8`

Commit recommandé :
```
fix(doc): BOUTIQUE_MODAL_ARCHITECTURE — corriger pipeline et multi-owners

- §0 ajoutée : pipeline source/dist obligatoire (modal.css n'est pas chargé directement)
- §6 réécrite : modal.css n'est pas propriétaire exclusif, 3 sources contribuent
- §8 enrichie : 2 cases checklist (bundle obligatoire + bon owner)

Suite lot CSS-4 du 18/05/2026.
```
