# KOMERCE — Architecture · Modal Produit Mobile

> **GEL v1.0 — Finitions F1-F5 appliquées**
> *Document de référence — Mobile gelé, ne pas réouvrir sans raison*

| Clé | Valeur |
|---|---|
| Statut | **GEL v1.0** — Mai 2026 — Finitions F1-F5 appliquées |
| Périmètre | `modal.css` §1 + §2 + `b-modal.js` + `b-modal-image-ux.js` + `b-modal-social-proof.js` |
| Breakpoint mobile | `< 900px` (base sans media query + guard `@max-width:899px`) |
| Fichier CSS | `boutique/css/modal.css` (1773 lignes après finitions) |
| Fichiers JS modifiés | `b-modal.js` : F1 `k-modal--has-promo` + F3 `_injectMobileDelivery` + F4 `_injectMobileTrust` |
| Doc complémentaire | `MODAL_DESKTOP_ARCHITECTURE.md` |

---

## 1. Diagnostic archi — pourquoi c'est proche du final

Lecture intégrale de §1 (L1-587) et §2 (L588-659) de `modal.css`, et des 3 modules JS associés. Verdict : la modal mobile est architecturalement solide. Elle a résolu les problèmes difficiles et implémente l'essentiel du pattern Temu. Les finitions F1-F5 ont été appliquées dans cette session.

### 1.1 Ce qui est déjà implémenté (liste exhaustive)

| Feature | Statut | Fichier / Lignes |
|---|---|---|
| Overlay + modal shell plein écran 100dvh avec animation slide-up | ✅ OK | `modal.css` L22-43 |
| Topbar sticky (`safe-area-inset-top`) + backdrop blur | ✅ OK | `modal.css` L44-95 |
| Scroll owner unique `.k-modal-scroll` (`flex:1, min-height:0`) | ✅ OK | `modal.css` L105-115 |
| Mobile guard §2 haute spécificité `#k-modal` (`flex:1` et `min-height:0` répétés) | ✅ OK | `modal.css` L628-659 |
| `display:contents` sur `.k-modal-product-zone` mobile (enfants dans flux scroll) | ✅ OK | `modal.css` L111-113 |
| Image edge-to-edge 45vh / 40vh (`max-width:600px`) / 50vh (`max-width:480px`) | ✅ OK | `modal.css` L115-145 |
| Skeleton shimmer CSS animé (disparaît à `is-image-loaded`) | ✅ OK | `modal.css` L120-145 |
| Carousel swipe horizontal avec lock de direction sur 8px | ✅ OK | `b-modal.js` L1773+ |
| Pull-to-close vertical : `transform translateY` + opacity + fermeture si dy > 100 | ✅ OK | `b-modal.js` L1773-1800 |
| Compteur "3/12" en bas-droite si > 5 images (Temu-style) | ✅ OK | `modal.css` L165-180 + `b-modal.js` |
| Bouton "Voir en grand" (pill semi-transparent bas-gauche) | ✅ OK | `modal.css` L183-196 |
| Lightbox fullscreen avec pinch-zoom natif (`touch-action:pinch-zoom`) | ✅ OK | `modal.css` L231-270 + `b-modal.js` L1800+ |
| Bouton favori (cœur) sur image, animation pop, état liked | ✅ OK | `modal.css` L198-230 |
| Details panel avec `border-radius:20px` "merge" sur image (`margin-top:-20px`) | ✅ OK | `modal.css` L273-290 |
| Prix + ancien prix + badge promo conditionnel | ✅ OK | `modal.css` L295-310 |
| Social proof conditionnel (rank / sold_count / rating) — zéro chiffre inventé | ✅ OK | `b-modal-social-proof.js` |
| `.k-modal-meta:empty { display:none }` — aucun bloc fantôme si pas de données | ✅ OK | `modal.css` L313 |
| Barre de recherche interne avec dropdown résultats + groupes + récents | ✅ OK | `modal.css` L330-450 |
| Actions sticky `position:fixed` (pas sticky) en bas avec fond opaque | ✅ OK | `modal.css` L453-500 |
| Topbar enrichie au scroll : miniature + nom + prix coral (`is-scrolled`) | ✅ OK | `modal.css` L527-545 |
| Suggestions en grille 2 colonnes avec chips filtrage sous-catégorie | ✅ OK | `modal.css` L547-590 |
| Variantes SKU couleur (swatches) + tailles (pills) | ✅ OK | `modal.css` L924-1091 |
| **F1** — Prix promo en coral sur mobile (`.k-modal--has-promo`) | 🆕 NOUVEAU | `modal.css` L319-320 + `b-modal.js` |
| **F2** — Ancien prix sur même ligne (`flex-wrap:nowrap` + `white-space:nowrap`) | 🆕 NOUVEAU | `modal.css` L318-321 |
| **F3** — Encart livraison mobile minimal (fallback "Livraison relais") | 🆕 NOUVEAU | `modal.css` + `b-modal.js` `_injectMobileDelivery()` |
| **F4** — Trust bar 3 pills mobile (Retrait relais / Cash / Échange 14j) | 🆕 NOUVEAU | `modal.css` + `b-modal.js` `_injectMobileTrust()` |
| **F5** — Swatches couleur ronds (`.k-sku--color border-radius:50%`) | 🆕 NOUVEAU | `modal.css` L1057-1065 |

---

## 2. Invariants mobile — à ne jamais violer

Ces invariants complètent les B-M-01 à B-M-08 de `BOUTIQUE_MODAL_ARCHITECTURE.md`.

| ID | Invariant | Pourquoi critique |
|---|---|---|
| **M-MOB-01** | `.k-modal-scroll` est LE seul scroll owner mobile. Aucun ancêtre ne doit avoir `overflow-y:auto` ou `scroll`. | Si un ancêtre scroll, le contenu ne scrolle plus dans `.k-modal-scroll` (bug invisible au premier coup d'œil). |
| **M-MOB-02** | `.k-modal-actions` est `position:fixed` (pas sticky) sur mobile. | `position:sticky` ne fonctionne pas dans un flex `overflow-y:auto`. Ce piège a déjà été résolu, ne pas le réouvrir. |
| **M-MOB-03** | `padding-bottom` sur `.k-modal-scroll` = `140px + env(safe-area-inset-bottom)`. Jamais inférieur. | Si insuffisant, le bas du contenu passe derrière la barre d'actions fixe. |
| **M-MOB-04** | `.k-modal-actions` a `background:var(--white) !important` sur mobile. Jamais transparent ni rgba. | `backdrop-filter` est silencieusement ignoré sur Samsung Internet et Chrome Android ancien. |
| **M-MOB-05** | `.k-modal-product-zone` est `display:contents` sur mobile. Jamais `display:flex` ni `grid`. | `display:contents` "dissout" le conteneur dans le flex de `.k-modal-scroll`. Les `order:` des enfants en dépendent. |
| **M-MOB-06** | La topbar recherche expandable est `position:absolute inset:0 z-index:410` (au-dessus de la topbar `z-index:400`). | Si le z-index est insuffisant, la topbar transparaît sous le mode recherche. |
| **M-MOB-07** | Le lock de direction du swipe est fixé à **8px** (pas plus, pas moins). | Sous 8px : trop de faux swipes verticaux. Au-delà : l'image commence à bouger avant le lock. |
| **M-MOB-08** | `touch-action:none` uniquement sur `.k-modal-actions`. Pas sur `.k-modal-scroll`. | `touch-action:none` sur le scroll owner détruirait le scroll natif du contenu. |
| **M-MOB-09** | `.k-modal-meta:empty` reste `display:none`. Ne jamais injecter un placeholder vide. | Fondement du principe "zéro chiffre inventé". Un social proof fantôme détruirait la crédibilité Komerce. |
| **M-MOB-10** | La lightbox fullscreen (`.k-modal-fullscreen`) a `display:none !important` sur desktop (`min-width:900px`). | Le zoom loupe desktop serait en conflit avec la lightbox si elle était accessible sur desktop. |
| **M-MOB-11** | Aucune media query `@media (min-width:600px)` sans borne supérieure dans §1 et §2. | Elle s'appliquerait aussi au desktop et créerait des conflits invisibles. |
| **M-MOB-12** | L'image d'index 0 déclenche le `killShimmer` au load. Les images 1..N n'ont pas de listener shimmer. | Mettre le listener sur toutes les images causerait plusieurs cycles de shimmer. |
| **M-MOB-13** | `.k-modal-delivery-mobile` et `.k-modal-trust-mobile` ont `@media(min-width:900px){display:none}`. Ne jamais retirer ce masquage desktop. | Les blocs enrichis de `b-modal-desktop-enhancers.js` gèrent la livraison et le trust desktop. Double affichage si le mobile n'est pas masqué. |

---

## 3. Carte des composants mobile — qui possède quoi

| Composant | CSS propriétaire | JS propriétaire | Bus events |
|---|---|---|---|
| Overlay + shell + animation | `modal.css` §1 L17-43 | — | `modal:open` / `modal:close` |
| Topbar (back, nav, cart, close) | `modal.css` §1 L44-95 | `b-modal.js` (`setupEnrichedTopbar`) | `modal:opened` / `product-changed` |
| Carousel + swipe + pull-to-close | `modal.css` §1 L115-161 | `b-modal.js` `setupImageZoneTouch()` | `carousel:changed` |
| Lightbox fullscreen + pinch-zoom | `modal.css` §1 L231-270 | `b-modal.js` `openImageFullscreen()` | — |
| Détails panel + prix + badge promo | `modal.css` §1 L273-315 | `b-modal.js` `openModal()` inject price | — |
| Prix promo coral (F1) | `modal.css` L319-320 (`.k-modal--has-promo`) | `b-modal.js` `openModal()` classList | — |
| Social proof (rank/sold/rating) | `modal.css` §1 L310-318 | `b-modal-social-proof.js` `setupSocialProof()` | `modal:product-changed` |
| Livraison mobile (F3) | `modal.css` `.k-modal-delivery-mobile` | `b-modal.js` `_injectMobileDelivery()` | — |
| Trust bar mobile (F4) | `modal.css` `.k-modal-trust-mobile` | `b-modal.js` `_injectMobileTrust()` | — |
| Actions sticky (qty/ajouter/acheter) | `modal.css` §1 L453-530 | `b-modal.js` (cart handlers) | `cart:updated` |
| Suggestions + chips + grille 2col | `modal.css` §1 L547-590 | `b-modal.js` `renderSuggestions()` | `subcat:filter` |
| Variantes SKU couleur ronds (F5) | `modal.css` `.k-sku--color` | `b-modal.js` `renderVariants()` | `variant:changed` |
| Mobile guard haute spécificité | `modal.css` §2 L628-659 (`#k-modal`) | — | — |

---

## 4. Finitions appliquées — détail des changements

### 4.1 F1 — Prix promo en coral

CSS ajouté dans `modal.css` §1 :

```css
.k-modal--has-promo .k-modal-price {
  color: var(--coral);
  font-size: clamp(20px, 5vw, 26px);
  font-weight: 700;
}
```

JS dans `b-modal.js` `openModal()` : ajout de `dom.modal.classList.add/remove('k-modal--has-promo')` selon `product.promo_pct`.

### 4.2 F2 — Ancien prix sur même ligne

CSS modifié dans `modal.css` §1 : `.k-modal-price-row` reçoit `flex-wrap:nowrap`. `.k-modal-old-price` reçoit `white-space:nowrap` et `flex-shrink:0`.

### 4.3 F3 — Encart livraison mobile

CSS ajouté : `.k-modal-delivery-mobile` (fond vert clair, `border-radius:10px`, `font-size:12px`). Masqué à ≥ 900px.

Injecteur JS : `_injectMobileDelivery(product)` insère l'encart après `.k-modal-meta`. Supporte `product.delivery_delay` si dispo, sinon fallback "3 à 5 semaines".

### 4.4 F4 — Trust bar mobile

CSS ajouté : `.k-modal-trust-mobile` + `.k-modal-trust-mobile-item` (3 pills, fond `var(--sand)`, `border-radius:999px`). Masqué à ≥ 900px.

Injecteur JS : `_injectMobileTrust()` insère le bloc juste avant `.k-modal-actions`.

### 4.5 F5 — Swatches couleur ronds

CSS ajouté après `.k-sku img` :

```css
.k-sku--color {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  padding: 0;
}
```

Classe à poser par `renderVariants()` sur les swatches sans image.

> Les modifications F1-F5 sont localisées dans `modal.css` §1 (< 900px) et `b-modal.js`. Aucun fichier desktop, aucun invariant M-MOB-01 à M-MOB-12 violé. Le bundling (`npm run bundle:css`) est nécessaire avant mise en prod.

---

## 5. Checklist de validation — avant merge

| ☐ | Test | Critère de succès |
|---|---|---|
| ☐ | Prix promo visible en coral | Coral, gras, `clamp` font-size sur produit avec promo |
| ☐ | Ancien prix sur même ligne | Pas de stacking vertical, baseline aligné, barré |
| ☐ | Encart livraison minimal visible | Présent même si `deliveryEstimate` absent — "Livraison relais" en fallback |
| ☐ | Trust bar 3 pills | Horizontal, lisible, au-dessus des boutons action |
| ☐ | Pull-to-close non cassé | Swipe vertical > 100px : fermeture. < 100px : snap back. |
| ☐ | Carousel swipe non cassé | Swipe horizontal snap correct. Lock direction 8px. |
| ☐ | Actions fixées en bas | `position:fixed`, fond blanc opaque, contenu ne passe pas derrière |
| ☐ | Social proof absent si pas de données | `.k-modal-meta` vide et invisible |
| ☐ | Lightbox fullscreen fonctionne | Tap image → plein écran → pinch-zoom natif → tap ferme |
| ☐ | Livraison/trust absents sur desktop | Ouvrir la modal à ≥ 900px : aucun encart livraison-mobile ni trust-mobile visible |
| ☐ | Test sur iPhone (Safari) et Android (Chrome) | Pas de débordement horizontal, scroll fluide, actions visibles |
| ☐ | Test Samsung Internet | Fond actions opaque (pas de transparence) |
| ☐ | Desktop non impacté | Rien ne change par rapport à avant la PR |

---

## 6. Ce qu'on ne touche PAS — liste de protection

### 6.1 Composants en gel total (ne pas réouvrir)

- **Pull-to-close** : implémentation parfaite (lock direction 8px, seuil 100px, opacity fade, animation close 260ms).
- **Swipe horizontal carousel** : lock de direction correct, snap back si < 40px, `goToSlide` sinon.
- **`position:fixed` des `.k-modal-actions`** sur mobile : le piège sticky a déjà été résolu par choix délibéré.
- **Fond opaque `!important`** sur `.k-modal-actions` : le `backdrop-filter` est inutile sur les targets mobiles Komerce.
- **`display:contents`** sur `.k-modal-product-zone` mobile : la logique `order:2/3` en dépend.
- **Social proof vide = `meta:empty` = `display:none`** : principe fondateur. Ne jamais injecter un placeholder.

### 6.2 Ce qu'on ne copie PAS de Temu mobile

- Timer "Lightning Deal fin dans 02:14:36" — faux, anxiogène, contraire à l'éthique Komerce
- "1 247 personnes regardent ce produit" — chiffre inventé
- "Plus que 3 en stock !" arbitraire — uniquement si stock réel exposé par l'API
- Stickers BEST SELLER non basés sur des données — uniquement `product.rank` réel

---

## 7. Règles pour l'après-gel

| Cas | Autorisé ? | Condition |
|---|---|---|
| Bug de régression introduit par une autre PR | ✅ OUI | Fix minimal uniquement. Valider les 13 invariants après. |
| Ajout d'un champ `ModalViewModel` qui ajoute un bloc optionnel mobile | ✅ OUI | Le bloc doit être `display:none` par défaut, révélé par classe. |
| Changement visuel demandé par le propriétaire | ✅ OUI | Documenter la raison. Valider les invariants. Mettre à jour ce document. |
| Refactoring "pour nettoyer" | ❌ NON | Le code est déjà propre. Refactorer sans objectif fonctionnel crée des régressions. |
| Revenir à `position:sticky` pour les actions | ❌ NON | Le bug sticky a déjà été résolu par choix délibéré. Ce serait une régression certaine. |
| Ajouter un social proof placeholder "pour les produits sans données" | ❌ NON | Contraire au principe fondateur. Aucune exception. |
| Retirer le `@media(min-width:900px){display:none}` des blocs mobile F3/F4 | ❌ NON | Causerait un double affichage livraison/trust sur desktop. |

---

## 8. Liens et co-références

| Document | Rôle |
|---|---|
| `MODAL_DESKTOP_ARCHITECTURE.md` | Document complémentaire — refonte desktop |
| `BOUTIQUE_MODAL_ARCHITECTURE.md` | Architecture CSS complète (§1-§7, invariants B-M-01→08) — à mettre à jour après gel |
| `boutique/css/modal.css` §1 L1-~650 | Source CSS mobile complète (1773 lignes après finitions) |
| `boutique/css/modal.css` §2 | Mobile guard haute spécificité — **JAMAIS supprimer** |
| `boutique/js/b-modal.js` | Orchestrateur modal — F1/F3/F4 injectés dans `openModal()` |
| `boutique/js/b-modal-image-ux.js` | Compteur 1/N + lightbox fullscreen + bouton Voir en grand |
| `boutique/js/b-modal-social-proof.js` | Social proof conditionnel (rank/sold/rating) — zéro chiffre inventé |
| `boutique/js/b-modal-desktop-enhancers.js` | Trust desktop + livraison desktop — **non touché** par cette PR (desktop only) |

---

*Komerce · Architecture Modal Mobile · GEL v1.0 · Mai 2026 · Finitions F1-F5 appliquées — Mobile gelé*
