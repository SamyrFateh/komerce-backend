# Komerce Boutique — Cartographie 360

> **Statut** : carte vivante du frontend boutique.
> **Mise à jour** : 2026-05-19 (création initiale après debug v3.1).
> **Convention** : ce document décrit l'état réel observé dans `boutique/`. Si tu trouves une divergence code ↔ doc, le code fait foi à l'instant T mais ouvre une PR pour aligner la doc. La doc doit suivre.
>
> **Lecture obligatoire** avant tout changement structurel : HTML, mutations DOM, classes body, flux utilisateur, build CSS.
>
> **Complète** (sans remplacer) `boutique/docs/BOUTIQUE_ARCHITECTURE.md` qui ne couvre que la doctrine CSS.

---

## 1. Topologie des fichiers

`boutique/` contient :

| Dossier | Rôle | Taille indicative |
|---|---|---|
| `index.html` | Page boutique unique, point d'entrée HTML (641 lignes) | 35 KB |
| `js/` | 30 modules JS ES6, ordre fixé par les imports depuis `main.js` | ~280 KB |
| `css/` | 16 sources CSS, **non** servies telles quelles | ~210 KB |
| `css/dist/` | 4 bundles regénérés au boot par `bundle-css.js` (cf. §2) | ~365 KB |
| `categories/` | 8 images statiques pour les chips catalogue | — |
| `event/` | 4 HTML autonomes pour le mode événement/cagnotte | — |
| `scripts/` | `bundle-css.js`, `audit-boutique-arch.js`, `gen-boutique-arch-live.js` | — |
| `docs/` | `BOUTIQUE_ARCHITECTURE.md` + `BOUTIQUE_ARCHITECTURE_LIVE.md` (CSS uniquement) | — |
| `shared-cart-account.html`, `shared-cart-public.html` | Pages secondaires panier partagé | — |

Les fichiers `.js` font tous moins de 2 100 lignes. Les god-objects côté front sont `b-modal.js` (2 096 l.), `css/modal.css` (1 737 l.), `b-cart.js` (1 635 l.), `css/boutique-desktop.css` (1 526 l.).

---

## 2. Pipeline de build CSS

`package.json` ne définit qu'un seul script pertinent : `npm run bundle:css` qui exécute `node scripts/bundle-css.js`.

**Comportement du bundler** (concaténation simple, pas de minification) :

| Bundle produit | Sources concaténées (dans cet ordre) |
|---|---|
| `dist/base.css` | tokens, reset, layout, hero |
| `dist/components.css` | categories, products, **modal**, cart, interactions, hero-cart-proxy, group-cart-flow, shared-followup |
| `dist/desktop.css` | boutique-desktop, desktop-commerce-skeleton |
| `dist/event.css` | tokens, event |

**Points critiques** :

- L'ordre `modal` avant `cart` dans `components.css` signifie qu'en cas de spécificité égale, **`cart.css` gagne** sur `modal.css`. C'est invisible à la lecture des sources isolées.
- Les fichiers `.css` sources qui ne sont dans aucun bundle sont **orphelins** (déployés sur disque mais jamais servis). Audit complet dans `BOUTIQUE_ARCHITECTURE_LIVE.md` §1.
- **Sur Railway**, le bundle est regénéré à chaque boot via `npm run build && node server.js` côté backend (voir backend `package.json`). Donc modifier une source CSS suffit ; pas besoin de commit du bundle. **Mais** le cache buster `?v=3` dans `index.html` lignes 68-71 est statique : un changement de source n'invalide pas les caches navigateur des utilisateurs sans bumper ce numéro.

---

## 3. Chargement de la page (index.html)

Ordre dans `<head>` puis `<body>` :

1. **Lignes 5-22** : `<script>` inline — détection mode, classes body initiales (`k-view-shop`).
2. **Ligne 59** : font Google (`Fraunces`, `Plus Jakarta Sans`).
3. **Lignes 68-71** : 4 bundles CSS dans cet ordre : `base → components → desktop → event` (cache buster `?v=3` statique).
4. **Ligne 74** : Stripe.js externe.
5. **Lignes 480-620** : `<script>` inline (probablement bootstrap données).
6. **Ligne 622** : `komerce-api.js` (classique, non-module).
7. **Ligne 624** : `main.js` (type=module). Point d'entrée ES.

**Conséquences** :

- Le CSS est entièrement chargé avant le JS module (correct, pas de FOUC).
- `komerce-api.js` est chargé en classique avant `main.js` qui est en module — donc l'API globale est disponible avant les imports ES.
- Aucun deferred script ; le HTML est entièrement parsé avant que `main.js` s'exécute (comportement par défaut des modules).

---

## 4. Graphe des modules JS

**Point d'entrée** : `main.js` (ligne 624 de l'index).

`main.js` importe dans l'ordre :

```
b-utils.js  (helpers purs, window.KUtils compat)
b-bus.js    (event bus, exposé en window._kbus)
b-store.js  (state, dom, SUBCATS, initDom)
boutique.js (logique applicative §3-§15)
b-desktop-upgrade.js (orchestrateur enhancers desktop)
b-scroll-owner.js (utilitaire scroll, owner unique)
b-product-open-contract.js (clic carte/panier → openModal)
b-cart-product-open-style.js (CSS dynamique panier)
```

**Hub central : `boutique.js`** importe 14 modules `b-*`. C'est lui qui orchestre les `setupX()` au DOMContentLoaded.

**Module pivot : `b-scroll-owner.js`** exporte 9 fonctions critiques (`isDesktop`, `getScrollY`, `scrollToPosition`, `scrollPageToTop`, `scrollPageToElement`, `installScrollOwner`, `ensureDesktopScrollOwner`, `clearInlinePagerStyles`, etc.). 14 fichiers JS l'importent. **Tout oubli d'import dans un consommateur produit un `ReferenceError` runtime invisible à la compilation** (cf. §10 pièges).

**Pas de bundler JS**. Les fichiers `js/*.js` sont servis tels quels par le serveur. ES modules natifs gèrent les dépendances dans le navigateur.

---

## 5. Structure DOM statique (index.html sous body)

Vérifiée par parser strict (gestion des commentaires HTML et quotes d'attributs).

**Top-level `<div id>` enfants directs de `<body>`** :

| Ligne | id | Rôle |
|---|---|---|
| 122 | `k-hero-fixed-wrap` | Hero header (logo, search, favoris, suivi, panier) — fixe sur mobile |
| 234 | `k-bar-spacer` | Spacer pour compenser le hero fixe |
| 236 | `k-page-scroll` | **Conteneur principal scrollable** : catégories, grilles produits, side-cart |
| 284 | `k-modal-overlay` | Overlay modale produit (Temu pleine page sur desktop, §7 de modal.css) |
| (X) | `k-cart-overlay` | Overlay panier (drawer mobile) — **doit être** frère de body, pas enfant |
| (X) | `k-cart-drawer` | Drawer panier — **doit être** frère de body |
| (X) | `k-order-modal` | Modal de commande / checkout — **doit être** frère de body |
| (X) | `k-toast` | Conteneur de toasts globaux |

**Pièges identifiés** :

- **Bug structurel `k-modal-overlay`** : sans la `</div>` ajoutée par HOTFIX v3.1, `k-modal-overlay` n'est jamais fermé et capture comme enfants `k-cart-overlay`, `k-cart-drawer`, `k-order-modal`, `k-toast`. Quand `k-modal-overlay` a `display:none` (état normal), tous ses enfants disparaissent. Quand il s'ouvre en pleine page, ses enfants s'empilent par-dessus la fiche produit, créant des états chaotiques.
- **Garde-fou nécessaire** : un check `precommit` qui parse `index.html` et exige les 8 IDs ci-dessus en frères directs de body (cf. §11).

---

## 6. Mutations DOM au runtime

**Aucun déplacement** de `k-modal-overlay`, `k-cart-drawer`, `k-order-modal` par le JS. Vérifié par grep exhaustif (`appendChild`, `insertBefore`, `prepend`, `insertAdjacent*`).

Donc la **structure DOM au runtime = structure HTML statique**. Si un parent est faux au runtime, c'est que le HTML est faux.

**Mais 82 `createElement('div')` au total** dans les modules JS, dont une vingtaine attachés à `document.body` directement. Tous ajoutent des éléments (FAB, toast, overlay temporaire, particules, side-cart, mini-cart, popovers). **Aucun ne déplace** d'élément existant.

Liste des appends critiques à `document.body` (utile à connaître pour le z-index) :

| Fichier | Élément ajouté | Quand |
|---|---|---|
| `b-cart.js:760, 826` | Overlay confirmation vidage panier / share | À l'usage |
| `b-cart.js:991` | Bouton flotant "Suivre ma commande" | Post-checkout |
| `b-cart.js:1394` | Nav contextuelle catalogue | Au scroll |
| `b-cart-pill.js:420-421` | Pill panier desktop + popover | Init desktop |
| `b-desktop-upgrade.js:37` | Bouton scroll-to-top | Init desktop |
| `b-mini-cart.js:223` | Mini-cart flottant | Init |
| `b-modal.js:573, 1836, 2043` | FAB back-top, overlay lightbox, overlay size guide | À l'usage |
| `b-group-cart-flow.js:41` | Overlay flux cagnotte | À l'usage |
| `komerce-api.js:283, 293` | Toast + élément debug | À l'usage |

---

## 7. États globaux (classes sur body)

Classes posées et retirées sur `<body>` au runtime, avec leurs effets CSS et leur cycle de vie.

### Classes statiques (init)

| Classe | Posée par | Rôle |
|---|---|---|
| `k-view-shop` | inline `<script>` lignes 5-22 + `boutique.js` init | Mode boutique (vs event, vs admin) |

### Classes dynamiques (cycle ouverture/fermeture)

| Classe | Posée par | Retirée par | Effet CSS principal |
|---|---|---|---|
| **`cart-open`** | `b-cart.js` (×6 : openCart ×3, renderCart, shareModal, loadSharedCart), `b-checkout.js`, `b-desktop-global-cart-access.js` | `b-cart.js` (closeCart), `b-checkout.js` (closeOrderModal), `b-nav.js` (switchView), `b-product-open-contract.js` | `cart.css` §1 : `body.cart-open .k-modal-overlay, .k-cats, .k-hero { pointer-events: none }` — **bloque tous les clics sur le catalogue tant que cart-open est posée** |
| **`modal-open`** | `b-modal.js:460` (`openModal()`) | `b-modal.js:726` (`closeModal()`) | `layout.css:581` : `overflow: hidden` sur body/html. `cart.css` ×11 règles : masque bnav, positionne la grille Temu, ajuste suggestions. `b-scroll-owner.js` : le listener wheel vérifie `body.modal-open` avant de rediriger vers window |
| **`modal-has-cart`** | `b-modal.js:463` — posée dans `openModal()` si `cartQty() > 0` au moment de l'ouverture | `b-modal.js:727` (`closeModal()`) | `modal.css` ×6 règles : active le side-cart desktop intégré à la fiche produit (le panneau droit qui affiche le panier en même temps que la fiche). Absent si panier vide à l'ouverture |
| `cart-empty` | `b-cart.js:498` (dans `renderCart()` si panier vide après suppression) | `b-cart.js:500` (dans `renderCart()` si panier non vide), `b-cart.js:453` (`closeCart()`), `b-product-open-contract.js:57` | CSS non détecté — probablement pour contrôler l'affichage du bouton "Vider" et du footer |
| `k-sg-open` | `b-modal.js:2076` (`openSizeGuide()`) | `b-modal.js:2083` (fermeture size guide) | `modal.css` ×1 règle : affiche l'overlay du guide des tailles |
| `k-modal-open` | **Non posée par le JS** — alias legacy CSS uniquement | — | `cart.css:262` : alias de `body.modal-open` pour `.k-wa-fab` (bouton WhatsApp flottant). Sélecteur de garde, jamais actif car le JS pose `modal-open` pas `k-modal-open`. **Dead CSS** à nettoyer |
| `is-open` | **Non posée sur body** — utilisée sur des éléments internes (`.k-modal-spec-body.is-open`) | — | `modal.css:804` : ouvre le panneau des spécifications produit. **Faux positif** du check CSS : `body.k-modal-spec-body.is-open` ne se lit pas comme `body.is-open` |

### Piège majeur connu

**`body.cart-open` verrouille les cartes catalogue** (`pointer-events: none`). Quand `checkoutCart()` ouvre le modal de commande, il fait `body.classList.add('cart-open')` ligne 81 de `b-checkout.js`. Tant que `closeOrderModal()` n'est pas appelé, les cartes catalogue derrière restent non-cliquables. C'est attendu (on ne veut pas qu'on clique pendant un checkout), mais si le modal de commande est mal positionné ou invisible (cf. bug HTML §5), l'utilisateur n'a aucun moyen visible de fermer le checkout → écran « bloqué ».

---

## 8. Cartographie CSS (par responsabilité)

Plus de détails dans `boutique/docs/BOUTIQUE_ARCHITECTURE.md` §3 (table sélecteur ↔ owner). Vue résumée :

| Fichier source | Bundle | Responsabilité |
|---|---|---|
| `tokens.css` | base + event | Variables CSS (couleurs, espacements, breakpoints) |
| `reset.css` | base | Reset, body.cart-open overflow |
| `layout.css` | base | Layout principal, overflow body, breakpoints |
| `hero.css` | base | Hero header fixe |
| `categories.css` | components | Chips catégories |
| `products.css` | components | Cartes produits catalogue |
| `modal.css` | components | **Fiche produit pleine page Temu (§7)** |
| `cart.css` | components | Panier drawer, modal commande, classes `cart-open` |
| `interactions.css` | components | Hovers, états actifs, bnav |
| `hero-cart-proxy.css` | components | Proxy panier dans le hero |
| `group-cart-flow.css` | components | Flux cagnotte / panier partagé |
| `shared-followup.css` | components | Followup post-commande |
| `boutique-desktop.css` | desktop | Adaptations desktop ≥ 900px |
| `desktop-commerce-skeleton.css` | desktop | Skeleton commerce desktop |
| `event.css` | event | Pages /event/* uniquement |

**Selectors critiques connus** (à protéger absolument) :

- `.k-modal-overlay.open` → `display: flex` + fond noir blur
- `body.modal-open .k-modal-overlay #k-modal` → grille 43/57 Temu (§7 ligne 1622 de modal.css)
- `body.cart-open .k-modal-overlay, .k-cats, .k-hero` → `pointer-events: none`
- `.k-order-overlay.open` → display + fond vert
- `#k-modal` height/width media-queries en cascade §3 / §4 / §5 / §6 / **§7** — §7 doit gagner partout

---

## 9. Flux utilisateur critiques

Cinq parcours documentés pas-à-pas. Pour chacun : déclencheur, classes posées, modules JS impliqués, état attendu en console.

### F1. Ouvrir une fiche produit depuis le catalogue

| Étape | Action | Effet |
|---|---|---|
| 1 | Clic sur `.k-card` (b-catalog.js:229) | Appelle `openModal(card.dataset.id)` |
| 2 | `openModal()` dans `b-modal.js:308` | Pose `body.classList.add('modal-open')`, `'modal-has-cart'` si panier non vide, ouvre `#k-modal-overlay` avec `.open` |
| 3 | Suggestions chargées, history pushée | `state.modalHistory.push(id)` |
| 4 | Fermeture par X ou Escape | `closeModal()` retire `.open`, retire les classes body, restore scroll |

**État attendu en console après ouverture** :
```
body.className = 'k-view-shop modal-open [modal-has-cart]'
getElementById('k-modal-overlay').classList.contains('open') === true
getElementById('k-modal-overlay').parentElement.tagName === 'BODY'
```

### F2. Ajouter un produit au panier

| Étape | Action | Effet |
|---|---|---|
| 1 | Clic `#k-add-cart-btn` dans la fiche produit | Appelle `addToCart(productId, qty)` de `b-cart.js` |
| 2 | `addToCart()` met à jour `state.cart` + persiste via `saveCart()` | Badge panier mis à jour, `__kmrcSideCart()` redessine le side-cart desktop |
| 3 | (Desktop) `renderSideCart()` réinjecte le HTML du side-cart | Reçoit le bouton `#k-sc-checkout` qui appelle `window.__kmrcCheckout` |

### F3. Ouvrir le panier (mobile drawer ou desktop sticky)

| Étape | Action | Effet |
|---|---|---|
| 1 | Clic icône panier hero (mobile) ou pill desktop | Appelle `openCart()` de `b-cart.js` |
| 2 | `openCart()` | Pose `body.cart-open`, ajoute `.open` sur `k-cart-overlay` et `k-cart-drawer`, sauve `scroll.savedY` |
| 3 | Fermeture | `closeCart()` retire les classes, restore scroll |

**État attendu après ouverture** :
```
body.className inclut 'cart-open'
getElementById('k-cart-drawer').classList.contains('open') === true
```

### F4. Cliquer "Commander" depuis le panier ou la fiche produit

| Étape | Action | Effet |
|---|---|---|
| 1 | Clic `#k-sc-checkout` (side-cart desktop) ou `#k-cart-checkout` (drawer) | Délègue à `window.__kmrcCheckout()` = `checkoutCart` de `b-checkout.js` |
| 2 | `checkoutCart()` ligne 67-100 | Si modale produit ouverte : émet `bus.emit('modal:close')`. Puis `closeCart()`, `renderCheckout()`, `dom.orderModal.classList.add('open')`, `body.cart-open` posée, `bnav` masqué |
| 3 | Sécurités de sortie | `Escape` ou clic sur overlay → `closeOrderModal()` |

**Piège connu** : entre les étapes 2a (`bus.emit('modal:close')`) et 2c (`scroll.savedY = getScrollY()`), `closeCart()` a déjà appelé `scrollToPosition(scroll.savedY)`. Si `savedY` valait 0 (cas où on était au top), le scroll reste à 0 mais surtout la nouvelle position n'est plus celle d'avant le clic. Comportement à valider en E2E.

### F5. Confirmer la commande (submitOrder)

| Étape | Action | Effet |
|---|---|---|
| 1 | Utilisateur remplit formulaire (bénéficiaire, téléphone, relais) et clique "Confirmer" | Appelle `submitOrder(btn)` de `b-checkout.js` |
| 2 | Validations synchrones | Vérifie nom bénéficiaire, téléphone, relais sélectionné. `showToast('error')` + return si invalide |
| 3 | Anti-double-clic | `btn.dataset.busy = '1'`, `btn.disabled = true`. Guard idempotence via `state.checkoutAttemptKey` |
| 4a | **Mode KMF (cash)** | `POST /api/orders` avec items + relais_id + mode=kmf → crée la commande directement |
| 4b | **Mode Stripe EUR** | `POST /api/orders` (crée la commande pré-autorisée) → `state.pendingStripeOrderRef` sauvegardé pour retry → `POST /api/payments/stripe/intent` → `stripe.confirmCardPayment()` |
| 5 | Succès | `clearCart()` → `renderOrderSuccess()` → toast "Commande confirmée !" |
| 6 | Échec | `showToast(error)` + débloque le bouton. L'ordre Stripe reste en `pendingStripeOrderRef` (retry sans double-charge grâce à l'idempotency key) |

**États body attendus pendant F5** :
```
body.className inclut 'cart-open'  ← posée par checkoutCart() à l'étape F4
Escape → closeOrderModal() → body.cart-open retirée
```

**Piège F5** : si Stripe échoue après que `/api/orders` a créé la commande côté serveur, `state.pendingStripeOrderRef` est conservé. Un second submit ne recrée pas la commande (guard `if (!state.pendingStripeOrderRef)`) — mais la commande backend est dans l'état "pré-autorisée" sans paiement. À surveiller en monitoring.

---

## 10. Pièges connus (et leur statut)

| # | Piège | Fichier | Statut | Hotfix |
|---|---|---|---|---|
| P-1 | `</div>` manquante : `k-modal-overlay` capture tous les modals suivants | `index.html` | ✅ Corrigé | HOTFIX v3.1 (2 `</div>` manquantes au total, pas 1) |
| P-2 | `b-desktop-upgrade.js` n'importe pas `getScrollY` ni `scrollPageToTop` → ReferenceError | `js/b-desktop-upgrade.js` | ✅ Corrigé | HOTFIX v1 |
| P-3 | `b-checkout.js` n'importe pas `getScrollY`, `scrollToPosition`, `scrollPageToTop` → ReferenceError sur `checkoutCart()` | `js/b-checkout.js` | ✅ Corrigé | HOTFIX v2 |
| P-4 | `b-catalog-desktop-enhancers.js` n'importe que `isDesktop`, manque scroll fns → enhancers desktop cassés | `js/b-catalog-desktop-enhancers.js` | ✅ Corrigé | HOTFIX v2 |
| P-5 | `b-cart-product-open-style.js` injecte `<link href="cart-product-open.css">` qui n'existe pas (orphelin) → CSP "Refused to apply style" | `js/b-cart-product-open-style.js` | ✅ Corrigé | HOTFIX v1 (injection retirée) |
| P-6 | Modale produit avec deux overlays empilés (k-modal-overlay + k-order-modal) qui cassent le scroll | `js/b-checkout.js` | ✅ Corrigé | HOTFIX v4 (`bus.emit('modal:close')` avant `closeCart`) |
| P-7 | `body.cart-open` reste posée après `checkoutCart()` → cartes catalogue cliquables=non | `css/cart.css:18-20` | ⚠ Volontaire mais surprenant | À documenter clairement (voir §7) |
| P-8 | Aperçu carte (hover overlay) et zoom loupe alourdissaient l'UI | `js/b-catalog-desktop-enhancers.js`, `js/b-modal-desktop-enhancers.js` | ✅ Désactivés | HOTFIX v4 (commentés) |
| P-9 | Bumper `?v=3` → `?v=4` non automatique sur changement CSS, cache navigateur résiduel | `index.html:68-71` | 🟠 Manuel | À automatiser via le bundler (hash auto) |
| P-10 | Bundle CSS regénéré à chaque boot Railway mais aucun garde-fou si bundler casse | `scripts/bundle-css.js` | 🟠 À renforcer | Ajouter un check de tailles non nulles en CI |

**Pièges suspects (non-confirmés)** :

- Le `scroll.savedY` partagé entre modale produit, drawer panier et modal commande peut être écrasé par les fermetures successives. À auditer en E2E F4.
- `body.modal-has-cart` est posée dynamiquement dans `openModal()` si `cartQty() > 0`. Le piège : si on vide le panier *depuis la modal ouverte*, `modal-has-cart` reste posée jusqu'à fermeture-réouverture.

---

## 10b. Registre complet du bus (`b-bus.js`)

Source unique de vérité des événements inter-modules. Tout ajout d'événement doit être documenté ici.

| Événement | Payload | Emetteur(s) | Consommateur(s) | Note |
|---|---|---|---|---|
| `modal:open` | `{ id }` | `b-cart.js:555,570` (clic image panier), `b-product-open-contract.js:148` | `b-modal.js:35` (`openModal`), `b-product-open-contract.js:148` | Découplage b-cart ↔ b-modal |
| `modal:close` | — | `b-cart.js:250` (quickAdd depuis modal), `b-checkout.js:74` (avant renderCheckout), `b-modal-desktop-enhancers.js:156` | `b-modal.js:32` (`closeModal`), `b-modal-desktop-enhancers.js:658` (stopFlashTimer) | |
| `modal:opened` | `product` (objet) | `b-modal.js:456` (fin de `openModal`) | `b-modal-desktop-enhancers.js:656` (`_onModalOpened`), `b-pager.js:230` (`_resetAllPagesBounceState`) | Déclenche les enhancers desktop |
| `modal:closed` | — | `b-modal.js:756` (fin de `closeModal`) | `b-pager.js:231` (`_resetAllPagesBounceState`) | |
| `cart:update` | — | Non émis dans le code actuel (prévu dans b-bus.js JSDoc) | `b-cart-pill.js:488` (re-render pill) | **Orphelin côté émetteur** : la pill se met à jour via appel direct, pas via bus |
| `catalog:cat-changed` | `cat` (string) | `b-catalog.js:255` (`setActiveCat`), `b-store.js:150` (`setActiveCatState`) | `b-catalog.js:84` (sync chip actif) | |
| `chip:center` | `chip` (Element) | `b-pager.js:98` (navigation pager) | `b-catalog.js:80` (`centerActiveChip`) | |
| `view:changed` | `tab` (string) | `b-nav.js:156` (`switchView`) | `b-catalog-desktop-enhancers.js:363` (masque/affiche sidebar) | |
| `cart:add` | — | Non émis (prévu JSDoc) | Non branché | Dead — prévu mais non implémenté |
| `cart:open` | — | Non émis (prévu JSDoc) | Non branché | Dead — prévu mais non implémenté |
| `cart:close` | — | Non émis (prévu JSDoc) | Non branché | Dead — prévu mais non implémenté |
| `search:query` | — | Non émis (prévu JSDoc) | Non branché | Dead — prévu mais non implémenté |
| `pager:navigate` | — | Non émis (prévu JSDoc) | Non branché | Dead — prévu mais non implémenté |
| `sidebar:built` | — | Supprimé (`b-desktop-sidebar.js:79` commenté) | Aucun listener | Orphelin supprimé — noté dans le code |

---

## 11. Garde-fous exécutables — plan

Lot suivant : créer ces scripts dans `boutique/scripts/` ou `scripts/` racine, à lancer en `precommit` et CI Railway.

| Script | Vérifie | Action si violation |
|---|---|---|
| `check-html-balance.js` | Parser HTML strict sur `index.html`. Vérifie : (1) tags équilibrés ; (2) IDs attendus en frères directs de body (cf. §5) ; (3) absence d'IDs imbriqués anormalement | Exit 1 + diff |
| `check-js-imports.js` | Pour chaque `b-*.js`, vérifier que toute fonction appelée et exportée par un autre module est bien importée. Spécialement pour `b-scroll-owner.js` (cause P-2, P-3, P-4) | Exit 1 + liste |
| `check-body-classes.js` | Lister toutes les classes body posées en JS (`body.classList.add`) et toutes les classes body utilisées en CSS (`body.X`). Détecter les classes utilisées en CSS mais jamais posées, ou posées sans remove appairé | Warning détaillé |
| `check-orphan-css.js` | Existe déjà via `audit-boutique-arch.js`. Aligner sur la liste §1 de `BOUTIQUE_ARCHITECTURE_LIVE.md` | Exit 1 |
| `check-cache-buster.js` | Vérifier que `?v=N` dans `index.html` lignes 68-71 est cohérent avec un hash du contenu des bundles. Si désync, bumper auto | Auto-bump + commit |

Détail d'implémentation à faire dans le lot 2 (étape 2 de la roadmap doc).

---

## 12. Maintenance de cette carto

**Quand mettre à jour ce document** :

- Ajout/suppression d'un fichier JS ou CSS → §1, §4, §8.
- Modification de la structure top-level de `index.html` (ajout/suppression d'un overlay, drawer, modal) → §5.
- Ajout d'une nouvelle classe body avec règle CSS associée → §7.
- Découverte d'un nouveau piège runtime → §10.
- Ajout d'un garde-fou exécutable → §11.

**Procédure** :

1. Modifier le code.
2. Mettre à jour ce document dans la même PR.
3. Mettre à jour la date de consolidation en tête.
4. Si la doctrine CSS change : mettre à jour aussi `boutique/docs/BOUTIQUE_ARCHITECTURE.md`.
5. Lancer `npm run boutique:arch` pour régénérer `BOUTIQUE_ARCHITECTURE_LIVE.md`.

**Règle d'or** : si tu hésites à mettre à jour, c'est que la carto a besoin d'être mise à jour. Le coût d'une carte fausse est élevé (cf. P-1 qu'on a mis 6h à diagnostiquer faute de carte).

---

## 13. Liens vers les autres documents

- `boutique/docs/BOUTIQUE_ARCHITECTURE.md` : doctrine CSS normative (un sélecteur, un owner). Court par discipline.
- `boutique/docs/BOUTIQUE_ARCHITECTURE_LIVE.md` : audit CSS auto-généré. Régénéré par `npm run boutique:arch`.
- `docs/CARTOGRAPHY_360.md` : cartographie 360 **backend** (sœur de ce document).
- `docs/SCHEMA.md`, `docs/ZONE_IMPACT.md`, `docs/CONTRACTS.md` : socle backend (non lié au front mais référencé par les flows checkout).
- `AGENTS.md` : règles globales agents (à mettre à jour pour pointer ici).

---

## 14. Routes serveur legacy désactivées (PR #486)

> Ajouté 2026-05-26 — B-DOC-1. Confirmé par analyse code `bootstrap/html-routes.js` et `routes/collective-workspaces.js`.

Le modèle Panier Événement Collectif / Workspace est **déclassé**. Les routes serveur correspondantes sont neutralisées depuis PR #486. Le modèle actif est le **panier partagé boutique-first** (`/boutique` → `b-share-cart.js`).

### Redirections HTML (302)

| Route serveur | Comportement | Fichier |
|---|---|---|
| `GET /event/create` | → `302 /boutique` | `bootstrap/html-routes.js` ligne 78 |
| `GET /event/manage/:creatorToken` | → `302 /boutique` | ligne 79 |
| `GET /event/w/:publicToken` | → `302 /boutique` | ligne 80 |
| `GET /event/pay/:paymentToken` | → `302 /boutique` | ligne 81 |
| `GET /event/:creatorToken/manage` | → `302 /boutique` | ligne 82 |
| `GET /workspace/:publicToken` | → `302 /boutique` | ligne 83 |

### API désactivées (410)

| Route API | Comportement | Fichier |
|---|---|---|
| `* /api/collective-workspaces/*` | `410 collective_workspace_disabled` | `routes/collective-workspaces.js` |
| `* /api/collective-payments/*` | `410 collective_workspace_disabled` | idem |

### Services tombstone (no-op)

| Service | État | Note |
|---|---|---|
| `services/collective-payment-orchestrator.js` | Tombstone no-op | Aucun cron, aucun PaymentIntent, aucun webhook traité |
| `services/collective-workspace-engine.js` | Encore importé par 3 services legacy | Non bloquant go-live — COLLECTIVE-CLEANUP planifié post go-live |

### Ce qui reste actif côté boutique

- `public/boutique/event/*.html` : pages statiques toujours présentes sur disque — **non supprimées**, mais le serveur redirige avant de les servir. Nettoyage progressif post go-live.
- `css/event.css` : toujours bundlé (tokens + styles event). Non bloquant.

---

**Fin de carto v1**. Validation requise avant publication. Étape suivante : garde-fous exécutables (§11).
