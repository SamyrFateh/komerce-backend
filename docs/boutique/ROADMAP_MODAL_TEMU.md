# Roadmap Modal Produit Komerce — inspiration Temu (sobre & efficace)

> **Périmètre :** modal produit (mobile + desktop) uniquement.
> **Méthode :** s'inspirer de Temu là où c'est efficace, rester cohérent avec le ton Komerce (artisanal, Comores, sobre). On ne réplique pas l'agressivité commerciale Temu.

---

## Audit de l'existant (état au 03/05/2026, après le fix scroll)

### Ce qui existe déjà et marche

**Mobile :**
- ✅ Carousel d'images avec swipe horizontal (`setupImageZoneTouch` dans `b-modal.js:1363`)
- ✅ Pull-to-close (swipe vertical bas → ferme la modal)
- ✅ Dots indicateurs sous l'image (`.k-modal-dots`)
- ✅ Topbar enrichie qui rappelle le produit pendant le scroll (`setupEnrichedTopbar`)
- ✅ Suggestions "Vous aimerez aussi" en grille 2 colonnes
- ✅ Chips de filtrage par sous-catégorie dans les suggestions
- ✅ Bouton "Acheter" + "Ajouter" + qty stepper en bas

**Desktop :**
- ✅ Layout 2 colonnes Temu-like (image sticky à gauche, détails à droite)
- ✅ Zoom-on-hover avec lens + preview latéral
- ✅ Miniatures verticales à gauche de l'image
- ✅ Breadcrumb dans la topbar
- ✅ Boutons partage WhatsApp + copier le lien
- ✅ Accordéon specs/détails
- ✅ Trust badges (retrait relais, paiement cash, stock garanti)
- ✅ Sous-total dynamique dans les actions

### Ce qui manque ou est à polir (par rapport à Temu)

**Mobile (priorité, vu que l'utilisateur compare avec Temu mobile) :**

1. **Indicateur de pagination "3/12" sur l'image** — Temu mobile affiche un compteur en bas à droite de l'image (`3/12`). Komerce affiche des dots, ce qui devient illisible au-delà de 5–6 images. L'utilisateur l'a explicitement remarqué.
2. **Bouton de partage flottant sur l'image** — Temu mobile a une icône upload en haut à droite de la photo. À évaluer (peut-être pas pertinent vu qu'on a déjà WhatsApp ailleurs).
3. **Zoom au tap** — Temu permet de tap-and-hold ou tap pour zoomer sur l'image. Aujourd'hui Komerce mobile ne propose pas de zoom (seul le desktop a la lens). À ajouter en mobile : tap → fullscreen image avec pinch-to-zoom natif du navigateur.
4. **Variantes / sélecteurs** — Si un produit a des variantes (taille, couleur), il faut pouvoir les choisir. Aujourd'hui le modèle de données expose `product.images[]` mais pas de variantes structurées. À voir avec le backend si pertinent.

**Desktop (polish, le gros est déjà là) :**

5. **Galerie verticale visible en permanence** — Temu desktop affiche les variantes/couleurs directement dans la zone droite, pas dans la zone image. On a déjà des miniatures à gauche, c'est ok pour le moment.
6. **Zone "Détails techniques" ouverte par défaut** — actuellement l'accordéon est fermé. Sur Temu, les specs sont visibles d'emblée. À considérer si on a vraiment du contenu technique.

**Cross-cutting :**

7. **Badge promo plus visible** — sur Temu, le `-26%` est sur fond orange massif. Komerce a `.k-modal-promo-badge` mais il est petit et discret. Décision design : on garde sobre ou on assume le côté "deal".
8. **Stock visible avec urgence** — Temu mobile affiche "Pre-order. Delivery: 6-15 business days" en encart orange. Komerce dit juste "✓ Disponible" en pastille verte. Pour Komerce (stocks réels chez artisans Comores), un délai estimé serait plus utile que le côté urgence.
9. **Note avis clients** — non présente dans Komerce. À ajouter quand on aura un système d'avis.
10. **Image full-width edge-to-edge sur mobile** — actuellement padding 16px autour de l'image. Temu va edge-to-edge. À tester visuellement.

---

## Roadmap proposée (3 vagues)

> Chaque vague est cadrée pour passer la checklist `ZONE_IMPACT.md` du repo.
> Aucune vague ne touche aux 6 invariants R1–R6 (orders, parcels, stock, sécurité).
> Modifications **frontend uniquement** : `public/boutique/css/modal.css`, `public/boutique/js/b-modal.js`, `public/boutique/js/b-desktop-upgrade.js`, `public/boutique/index.html`.

### Vague 1 — Mobile parity (≈ 3h, faible risque)

**Objectif :** combler les écarts visibles à l'œil nu vs Temu mobile, sans changer le modèle de données.

| # | Item | Fichiers | Effort |
|---|------|----------|--------|
| 1.1 | Compteur `3/12` en bas à droite de l'image, masque les dots si ≥ 6 images | `modal.css` (nouvelle classe `.k-modal-counter`), `b-modal.js` (sync dans `goToSlide`) | 30 min |
| 1.2 | Image edge-to-edge mobile (retirer padding latéral sur `.k-modal-img-wrap`) | `modal.css` | 10 min |
| 1.3 | Tap sur l'image → ouverture en plein écran avec pinch-zoom natif | `b-modal.js` (nouvelle fonction `openImageFullscreen`), `modal.css` (.k-modal-img-fullscreen) | 1h |
| 1.4 | Délai estimé sous le prix ("Reçu à Moroni en 5–10 jours") au lieu de juste "Disponible" | `b-modal.js` (templating dans `openModal`), data : nouveau champ `delivery_estimate` côté backend (optionnel, fallback ok) | 45 min |
| 1.5 | Ajout "écran de chargement" image (skeleton gris animé pendant que la photo charge) | `modal.css` | 30 min |

**Critères de fin de vague :** sur Pixel-like 400×820, modal produit indistinguable visuellement de Temu mobile sur l'essentiel, sans agressivité commerciale.

### Vague 2 — Desktop polish (≈ 2h, très faible risque)

**Objectif :** finitions desktop, parce que le gros est déjà bien.

| # | Item | Fichiers | Effort |
|---|------|----------|--------|
| 2.1 | Specs ouvertes par défaut si elles existent (sinon masquées) | `b-desktop-upgrade.js` | 15 min |
| 2.2 | Carousel principal cliquable même sans hover (swap de slide au clic sur les côtés gauche/droit) | `b-desktop-upgrade.js`, `modal.css` (zones cliquables overlay) | 45 min |
| 2.3 | "Vu récemment" en bas (sous suggestions) — utilise `state.viewedHistory` qui existe déjà | `b-modal.js` (nouvelle section), `modal.css` | 1h |

**Critères de fin de vague :** desktop a une densité d'info comparable à Temu sans copier les éléments tape-à-l'œil (timer, "X personnes regardent ce produit", etc.).

### Vague 3 — Variantes structurées (≈ 8h, risque moyen, dépend backend)

**Objectif :** support multi-variantes (taille / couleur). À ne lancer que si nécessaire pour le catalogue Komerce. À discuter avec le propriétaire avant de coder (cf. checklist `ZONE_IMPACT.md` ligne 6).

| # | Item | Effort |
|---|------|--------|
| 3.1 | Schéma `product_variants` côté DB (id, product_id, variant_type, variant_value, sku, stock, price_override, image_url) | 2h |
| 3.2 | Endpoint `/api/products/:id/variants` | 1h |
| 3.3 | UI de sélection variantes dans la modal (chips horizontales scrollables sous le prix) | 3h |
| 3.4 | Sync image principale et stock selon variante choisie | 1h |
| 3.5 | Validation côté checkout : vérifier que la variante choisie est bien en stock au moment du paiement | 1h |

**⚠️ Pré-requis :** cette vague touche `orders`, `stock`, et le checkout. Donc déclenche les invariants R1, R3, R5. **Validation propriétaire requise.** Documenter la migration DB dans `docs/_pending/` avant de coder, comme le veut la gouvernance.

---

## Ce qu'on **ne** copie **pas** de Temu (volontairement)

Komerce a un positionnement artisanal et local (Comores), pas low-cost agressif. Donc on évite :

- ⛔ Timer "Lightning Deal — fin dans 02:14:36" → faux et anxiogène
- ⛔ "1 247 personnes regardent ce produit" → faux et anxiogène
- ⛔ "Plus que 3 en stock !" si c'est arbitraire — uniquement si vrai
- ⛔ Encarts "Free shipping / Free returns" massifs en haut de la page → on est en local Comores, la livraison a un coût et un délai assumés
- ⛔ Multiplication des CTA orange/rouge → garder le vert ocean Komerce comme couleur principale, le coral en accent
- ⛔ Crédits / cashback factices ("$1.800 Credit for delay")
- ⛔ Stickers "BEST SELLER" / "MOST POPULAR" si non basés sur des vraies métriques

---

## Suggestions de PR

1. **PR-A** (Vague 1.1 + 1.2 + 1.5) — quick wins visuels, mergeable seul.
2. **PR-B** (Vague 1.3) — fullscreen image, isolable.
3. **PR-C** (Vague 1.4) — délai estimé, dépend de l'ajout `delivery_estimate` côté product.
4. **PR-D** (Vague 2.1 → 2.3) — desktop polish, mergeable d'un bloc.
5. **PR-E** (Vague 3) — variantes : éclater en 3 PR (DB+API, UI sélecteur, intégration checkout).

Chaque PR commite **toutes les 10 min** comme demandé par la règle 🔴 du README.

---

## Ordre recommandé

1. ✅ Fix scroll mobile (déjà livré aujourd'hui)
2. PR-A (≈ 1h10) — donne immédiatement une sensation Temu mobile sans rien casser
3. PR-D (≈ 2h) — finit de polir le desktop, le rend cohérent
4. PR-B (≈ 1h) — fullscreen image
5. Décision propriétaire sur Vague 3 (variantes) avant d'engager
6. PR-C (≈ 45 min) — quand le backend a `delivery_estimate`

**Total Vague 1+2 sans variantes : ~5h de dev frontend pur, zéro risque sur les invariants.**
