# Boutique — Component Ownership

> Mis à jour : **2026-06-28**  
> Statut : document actif pour savoir **où toucher le code Boutique**.

---

## 1. Règle fondamentale

```txt
Un composant = une vérité.
Pas de doublon HTML.
Pas de logique parallèle.
Pas de CSS qui compense une erreur JS.
Pas de JS qui recrée ce qu'un renderer sait déjà faire.
```

Si tu ne sais pas quel fichier possède une zone, commence par `docs/boutique/README.md`.

---

## 2. Doctrine produit active

La Boutique suit **Boutique First**.

Pour le panier partagé :

```txt
Le lien partagé ouvre la boutique.
Le participant consulte en lecture seule.
Il règle sa part seulement si le panier est payable.
```

Les anciennes notions `panier collectif`, `workspace`, `event`, `settlement`, `engagement`, `contribution` sont historiques comme langage produit. Elles peuvent exister dans du code legacy, mais ne doivent pas guider une nouvelle modification UI.

---

## 3. Table de propriété

| Zone / composant | Fichier propriétaire | Possède | Ne doit pas posséder |
|---|---|---|---|
| Schéma boutique | `public/boutique/js/shop-schema.js` | catégories, sous-catégories, images, ordre, `dbKeys`, normalisation | DOM, listeners, layout, scroll |
| Rail catégories markup | `public/boutique/js/render/render-categories.js` | HTML des chips catégories | clics, état actif, pager, scroll |
| Orchestration accueil | `public/boutique/js/controllers/home-controller.js` | montage rail, clics catégories, active state, subcats desktop | données catégories, cartes produit, internals pager |
| Catalogue | `public/boutique/js/b-catalog.js` | chargement produits, filtrage, pagination, appel renderers, ouverture modal via contrat | schéma catégories, markup rail, HTML carte dupliqué, internals modal |
| Pager catégories mobile | `public/boutique/js/b-pager.js` | cage mobile, scroll sync, ghost loop, auto-advance | rendu rail, cartes produit, layout desktop |
| Sous-catégories mobile | `public/boutique/js/b-subcat.js` | mode flat sous-catégorie mobile | pager catégories principales, données catégories |
| Sections home | `public/boutique/js/render/render-home-sections.js` | markup sections catalogue | filtrage, pagination, rail catégories |
| Carte produit | `public/boutique/js/render/render-product-card.js` | HTML d'une carte produit | mutation panier/favoris, ouverture modale globale |
| Panier personnel | `public/boutique/js/b-cart.js` et modules cart dédiés | état panier, rendu panier, actions panier | rendu produit global, panier partagé |
| Modal produit — façade | `public/boutique/js/b-modal.js` | compatibilité surface publique, délégation modal | pager, hero, rendu catalogue, panier partagé |
| Modal produit — orchestration | `public/boutique/js/b-modal-core.js` | cycle ouverture/fermeture, body lock, topbar, recherche interne, composition modules modal | détail métier produit isolé, CSS durable |
| Modal produit — contenu | `public/boutique/js/b-modal-product.js` | rendu produit, prix, variantes, livraison/trust mobile, actions produit | lightbox image, navigation globale, panier partagé |
| Modal image / Voir en grand | `public/boutique/js/b-modal-image-ux.js` + `public/boutique/css/modal-media.css` | carousel, compteur, bouton **Voir en grand**, fullscreen image | rendu produit, prix, grille catalogue |
| Modal social proof | `public/boutique/js/b-modal-social-proof.js` | rank/sold/rating conditionnels, zéro chiffre inventé | données inventées, layout global |
| Modal navigation | `public/boutique/js/b-modal-nav.js` | précédent/suivant produit dans la modal | pager catégories, navigation page |
| Modal suggestions | `public/boutique/js/b-modal-suggestions.js` | suggestions et produits liés dans la modal | classement global recommandations |
| Modal panier | `public/boutique/js/b-modal-cart.js` | actions panier personnel depuis la modal | checkout final, panier partagé |
| Partage panier | `public/boutique/js/b-share-cart.js` | création lien panier partagé, choix `ready_to_pay/needs_validation`, message WhatsApp | rendu complet vue participant, paiement direct hors boutique |
| Vue panier partagé | `public/boutique/js/b-group-view.js` | rendu participant/créateur, `?p=TOKEN`, lecture seule snapshot, bouton `Régler ma part` | panier personnel, catalogue live, mutation participant |
| API panier partagé frontend | `public/boutique/js/group/group-api.js` | appels HTTP panier partagé | rendu UI, mapping de statut humain |
| Rendu créateur panier partagé | `public/boutique/js/group/group-render-creator.js` | blocs créateur, actions créateur | vue participant, mutation directe backend hors API dédiée |
| Styles catégories | `public/boutique/css/categories.css` | `.k-cats`, `.k-chip`, catégories mobile/base | pager, desktop global, produits |
| Hero base/mobile | `public/boutique/css/hero.css` | hero mobile/base, sticky bar visuelle | neutralisation cage pager mobile |
| Grille produits + cartes | `public/boutique/css/products.css` | `.k-grid`, `.k-sec-grid`, `.k-card` | side-cart, modal, catégories |
| Desktop premium | `public/boutique/css/boutique-desktop.css` | layout desktop, side-cart, hero desktop, sous-catégories desktop, guards desktop | comportement mobile, cage `#k-page-scroll` |
| Panier / checkout CSS | `public/boutique/css/cart.css` | panier personnel, side-cart, checkout, OTP | panier partagé si sélecteurs `.k-group-*` |
| Panier partagé CSS | `public/boutique/css/group-cart-flow.css` | vue groupe/partagée, suivi, lecture seule, états Boutique First | catalogue, modal produit globale |
| Modal CSS shell | `public/boutique/css/modal-shell.css` | shell, overlay, topbar, scroll, actions | media/carousel, panier partagé, catégories |
| Modal CSS media | `public/boutique/css/modal-media.css` | images, carousel, media, bouton **Voir en grand** | rendu produit, grille catalogue |
| Modal CSS produit | `public/boutique/css/modal-product.css` | détails produit, prix, zones d'action produit | shell, media, panier partagé |
| Modal CSS extension desktop | `public/boutique/css/modal-product-lot4-hybrid.css` | extension PDP hybride desktop | mobile global, panier partagé |
| Event legacy | `public/boutique/css/event.css` | compatibilité event/workspace legacy | nouvelle UX Boutique First |

---

## 4. Contrats par zone sensible

### Modal produit catalogue

Fichiers clés :

```txt
public/boutique/js/b-modal.js
public/boutique/js/b-modal-core.js
public/boutique/js/b-modal-product.js
public/boutique/js/b-modal-image-ux.js
public/boutique/js/b-modal-social-proof.js
public/boutique/js/b-modal-nav.js
public/boutique/js/b-modal-suggestions.js
public/boutique/js/b-modal-cart.js
public/boutique/js/view-models/modal-view-model.js
public/boutique/css/modal-shell.css
public/boutique/css/modal-media.css
public/boutique/css/modal-product.css
public/boutique/css/modal-product-lot4-hybrid.css
```

Interdits :

```txt
Ne pas corriger le bouton Voir en grand depuis b-catalog.js.
Ne pas corriger le media modal depuis products.css.
Ne pas afficher un article snapshot panier partagé avec la modal catalogue vivante.
Ne pas déplacer le comportement lightbox hors de b-modal-image-ux.js sans mettre à jour cette table et la carte catalog.
```

Tests :

```bash
npm run gate:boutique-ownership
cd public/boutique
npm run check:imports
npm run check:html
npm run audit:arch
```

---

### Panier partagé Boutique First

Fichiers clés :

```txt
b-share-cart.js
b-group-view.js
group/group-api.js
group/group-helpers.js
group/group-render-creator.js
css/group-cart-flow.css
```

Interdits :

```txt
Ne pas envoyer le participant directement au checkout.
Ne pas appeler le catalogue live pour la fiche lecture seule.
Ne pas modifier le panier partagé depuis la vue participant.
Ne pas afficher open/closed/awaiting_choice comme langage humain.
Ne pas réintroduire le vocabulaire financement collectif comme UX principale.
```

Tests :

```bash
cd public/boutique
npm run check:group-wording
npm run check:imports
npm run check:html
npm run audit:arch
```

Puis tests manuels Cas A à E du guide `docs/implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md`.

---

### Catégories

Chaîne de vérité :

```txt
shop-schema.js
→ render-categories.js
→ home-controller.js
→ b-pager.js uniquement pour le déplacement mobile
```

`index.html` ne doit pas devenir une seconde source de vérité pour les catégories.

---

### Mobile

Le mobile repose sur :

```txt
hero fixe
+ sticky bar catégories
+ #k-page-scroll en cage fixed
+ b-pager.js qui calcule --pager-top / --pager-h
+ #k-grid en pager horizontal catégories
```

Ne pas corriger un problème mobile depuis `boutique-desktop.css`.

Pour la modal mobile, lire `docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md`. Le parcours **Voir en grand** appartient à `public/boutique/js/b-modal-image-ux.js` et `public/boutique/css/modal-media.css`.

---

### Desktop

`boutique-desktop.css` porte l'expérience desktop premium hors sources communes : header, side-cart, hero desktop, sous-catégories desktop, guards desktop.

Ne pas redéclarer `.k-grid` ou `.k-card` si le besoin appartient à `products.css`.

---

## 5. Règle de validation

Une modification est acceptable si :

- le fichier owner est le bon ;
- aucun owner parallèle n'est créé ;
- les tests automatiques applicables passent ;
- les tests manuels du parcours touché sont faits ;
- le guide `docs/boutique/README.md` reste le point d'entrée pratique.

---

## 6. Backfill rattachement global Boutique (governance/boutique-global-ownership)

> Passe de backfill : rattacher les fichiers Boutique aux cartes `features/*.feature.js`
> existantes (jamais une carte "boutique" unique qui possède tout). Voir `AGENTS.md` §0/§2.

### 6.1 Rattachements effectués

| Fichier Boutique | Carte | Justification |
|---|---|---|
| `js/group/group-api.js`, `js/group/group-helpers.js`, `js/group/group-render-creator.js`, `js/group/group-state.js` | `shared-cart` | Header `@komerce-arch` `domain=shared-cart` confirmé dans `docs/BOUTIQUE_360.json` |
| `js/collective-close-order-service.js`, `js/collective-ready-to-order-orchestrator.js` | `shared-cart` | Idem — `domain=shared-cart`, miroir frontend des services backend `services/collective-*` déjà dans la carte |
| `css/paypal.css` | `payments` | Seul CSS payment-specific univoque (cf. 6.2 pour `cart.css`) |
| `js/b-identity.js`, `js/b-phone.js`, `css/identity.css` | `auth` | Header `domain=auth` confirmé |
| `js/main.js`, `js/komerce-api.js`, `js/b-store.js`, `js/b-bus.js`, `js/b-utils.js`, `js/b-scroll-owner.js`, `index.html` | `operations` (transversal) | Socle technique Boutique, aucune règle métier propre — header `layer=state/api-client/ui-infrastructure/util`, transverse à toutes les features |
| `public/boutique/scripts/**` | déjà couvert | Exclu nativement par `EXCLUDE` dans `scripts/touched-files-feature-gate.js` (`/(^|\/)scripts\//`) — aucune déclaration supplémentaire nécessaire |
| `js/shop-schema.js`, `js/b-pager.js`, `js/b-subcat.js` | `catalog` | Header `domain=catalog` — schéma/navigation catégories, déjà dans `perimeter.in` de la carte |

### 6.2 Dette explicite — non rattaché volontairement

Ces fichiers restent **sans carte** après cette passe. Ne pas les rattacher au hasard ; statuer dans une PR dédiée.

| Fichier | Domaine observé (header) | Raison du report |
|---|---|---|
| `js/b-cart.js`, `js/b-cart-core.js`, `js/b-cart-pill.js`, `js/b-mini-cart.js`, `js/b-favs.js`, `js/b-cart-product-open-style.js` | `boutique`/`catalog`, criticité moyenne à critique | Aucune carte "panier personnel" ou "favoris" n'existe dans `features/*.feature.js`. Créer une telle carte dépasse le périmètre de ce backfill (pas de méga-feature, pas de carte inventée sans validation produit). |
| `css/cart.css` | — | CSS multi-domaine (panier personnel, side-cart, checkout, OTP) sans owner unique propre — ne peut pas être rattaché à `payments` sans capturer aussi le panier personnel hors périmètre |
| `js/b-modal-approche-c-hybrid.js`, `js/b-mobile-modal-v1.js` | `boutique`, `layer=ui-experiment` | Variantes/expérimentations modal hors de la liste curatée de `catalog.feature.js`. À trancher : promotion dans `catalog` ou dépréciation explicite. |
| `js/event-manage.js`, `js/event-public.js` | `collective-workspace` | Domaine legacy "event/workspace" — `docs/boutique/README.md` §1 le classe comme historique sauf reprise explicite. Aucune carte active ne couvre ce domaine. |
| `js/b-nav.js`, `js/boutique.js` | `boutique`, criticité haute/critique | Candidats plausibles pour `operations`, mais hors de la liste explicite demandée pour ce backfill. Laissés en dette pour décision séparée plutôt que rattachement par extension non validée. |
| `js/b-boutique-wow-style.js`, `js/b-desktop-global-cart-access.js`, `js/b-desktop-sidebar.js`, `js/b-desktop-upgrade.js`, `js/b-greeting.js`, `js/b-home-premium-v1.js`, `js/b-mobile-premium-v1.js`, `js/card-config.js` | `boutique`, criticité `None`, doctrine vide | Headers génériques sans signal sémantique fort — domaine réellement ambigu |
| `css/boutique-desktop.css`, `css/event.css`, `css/hero.css`, `css/interactions.css`, `css/layout.css`, `css/reset.css`, `css/tokens.css` | — | CSS transverse/socle sans owner fonctionnel unique — candidats à un futur transversal CSS dédié, non créé dans cette passe |
| `apply-komerce-cleanup.js` | — | Installeur idempotent ponctuel à la racine `public/boutique/`, pas un composant applicatif runtime — hors périmètre carte-first (même statut que `scripts/**`, mais hors du dossier `scripts/` donc non couvert par l'exclusion native) |
| `playwright-report/index.html` | — | Artefact généré par les runs Playwright (rapport HTML), pas du code source — ne devrait probablement pas être committé ; signalé ici plutôt que rattaché à une feature |
| `test-modal-view-model.html` | — | Page de test/redirection à la racine, hors flux applicatif Boutique courant |

### 6.3 `recommendations.feature.js` — aucun ajout

Aucun fichier Boutique frontend n'a de header `domain=recommendations`. Le rendu des suggestions (`b-modal-suggestions.js`, `b-pdp-curation-suggestions.js`) reste dans `catalog` par design : le contrat de `catalog.feature.js` déclare explicitement `recommendations` en `perimeter.out` ("mise en avant / classement"), `recommendations` ne fait que consommer `catalog` en lecture. C'est cohérent, pas une dette.

