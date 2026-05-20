# HOTFIX v4 — Empilement modales + désactivation aperçu carte et zoom loupe

> Date : 2026-05-19
> Suite du HOTFIX v3 (qui a réglé l'invisibilité du modal de commande).

---

## 3 changements légers dans 3 fichiers

### 1. `b-checkout.js` — Empilement des modales

**Symptôme** : quand on clique « Commander » depuis la modale produit pleine page (Temu), le formulaire de commande s'ouvre **par-dessus**. La modale produit reste visible en arrière-plan, le scroll devient chaotique.

**Cause** : `checkoutCart()` ferme le drawer panier (`closeCart()`) mais ne ferme pas la fiche produit (`#k-modal-overlay`). Les deux overlays s'empilent, chacun avec son propre scroll.

**Fix** : émettre `bus.emit('modal:close')` avant `closeCart()` si la modale produit est ouverte. C'est le canal propre qui évite les imports circulaires (b-modal.js écoute déjà `modal:close` ligne 32).

```diff
  export function checkoutCart() {
    if (state.cart.length === 0) { showToast('Votre panier est vide.', 'error'); return; }
+   // FIX 2026-05-19 : fermer la modale produit avant le checkout
+   if (dom.modalOverlay && dom.modalOverlay.classList.contains('open')) {
+     bus.emit('modal:close');
+   }
    closeCart();
```

### 2. `b-catalog-desktop-enhancers.js` — Aperçu carte désactivé

Sur demande produit : l'overlay au survol des cartes catalogue (nom + prix + boutons Quick View / Fav / Ajouter) ne montre plus rien d'utile et alourdit la UI.

**Fix** : commenter l'appel à `setupCardHoverObserver()` dans `setupCatalogDesktopEnhancers()`. Le code reste en place (fonctions intactes) pour réactivation en 1 ligne si besoin.

```diff
  export function setupCatalogDesktopEnhancers() {
    if (!isDesktop()) return;
    setupSubcatOnHover();
    setupPromoStrip();
    setupHomepageMerchandising();
    setupHeroSearchBar();
-   setupCardHoverObserver();
+   // DÉSACTIVÉ 2026-05-19 : aperçu carte (hover overlay) retiré sur demande produit.
+   // setupCardHoverObserver();
    _setupViewChangedGuard();
  }
```

### 3. `b-modal-desktop-enhancers.js` — Zoom loupe désactivé

Sur demande produit : la loupe Temu qui suit la souris sur l'image dans la modale produit est désactivée. À revoir dans le lot d'aménagement Temu de la modale.

**Fix** : commenter `setupZoom()` dans `_onModalOpened()`. Le code reste pour réactivation rapide.

```diff
    injectShareRow();
    injectRecentlyViewed();
    updateSubtotal();
-   setupZoom();
+   // DÉSACTIVÉ 2026-05-19 : zoom loupe Temu retiré sur demande produit.
+   // setupZoom();
  });
```

---

## Application

Remplacer les 3 fichiers dans `public/boutique/js/` :
- `b-checkout.js`
- `b-catalog-desktop-enhancers.js`
- `b-modal-desktop-enhancers.js`

## Validation post-déploiement

- [ ] Hard reload (`Cmd+Shift+R`).
- [ ] Ouvrir une fiche produit pleine page → **pas de loupe au survol de l'image**.
- [ ] Survoler une carte produit du catalogue → **pas d'overlay nom+prix+boutons** qui apparaît.
- [ ] Depuis la fiche produit, ajouter au panier → cliquer Commander → **le formulaire de commande s'ouvre proprement, la fiche produit se ferme**, plus d'empilement, scroll normal.
- [ ] Annuler le formulaire de commande (Escape ou croix) → retour au catalogue, pas à la fiche produit qui restait ouverte derrière.

## Lot suivant : aménagement Temu de la modale

Lot séparé. Tu m'envoies une référence visuelle Temu (capture d'une fiche produit qui te plaît). Je te livre une maquette HTML/CSS de ce que pourrait devenir la modale (densité, ordre des blocs, badges sociaux, livraison estimée, etc.) avant de toucher au code.

## Commit suggéré

```
fix(boutique): fermer fiche produit avant checkout + désactiver aperçu carte et zoom loupe

- b-checkout.js : bus.emit('modal:close') avant closeCart() si la modale produit
  est ouverte. Évite l'empilement des overlays k-modal-overlay + k-order-modal
  qui cassait le scroll et laissait la fiche produit visible derrière le
  formulaire de commande.

- b-catalog-desktop-enhancers.js : commenter setupCardHoverObserver. Aperçu
  carte (hover overlay) désactivé sur demande produit. Code en place pour
  réactivation 1-ligne.

- b-modal-desktop-enhancers.js : commenter setupZoom. Loupe Temu sur image
  modale désactivée sur demande produit. Code en place pour réactivation
  1-ligne. À revoir dans le lot aménagement Temu modale.

Branche : fix/frontend-HOTFIX-4-checkout-stack-and-toggle-hover-zoom
```
