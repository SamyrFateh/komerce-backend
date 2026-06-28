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
| Helpers panier partagé | `public/boutique/js/group/group-helpers.js` | formatage, statut humain, business status | DOM, appels API |
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
