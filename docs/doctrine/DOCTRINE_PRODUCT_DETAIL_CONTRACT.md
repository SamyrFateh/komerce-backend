# Doctrine du contrat détail produit Komerce

> **Version** : 1.0 — 2026-07-12
> **Statut** : doctrine active — frontière canonique entre catalogue, moteurs métier et fiche produit
> **Feature propriétaire du contrat** : `catalog`
> **Consommateurs** : `modal-product`, `orders`, `recommendations`
> **Contributeurs de vérité** : `catalog`, `logistics`, `economic-engine`
> **Documents liés** : `DOCTRINE_CATALOGUE.md`, `DOCTRINE_INGESTION_CATALOGUE.md`, `DOCTRINE_TRANSPORT_RAILS.md`, `docs/specs/DECISION_MODELE_STOCK_SKU.md`, `docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md`

---

## 1. Phrase de vérité

> **La raffinerie préserve et raffine les faits produit. Les moteurs métier résolvent les vérités dynamiques. Le contrat détail compose l'état commercial. La modal sélectionne et rend.**

Corollaire UX :

> **Une intelligence produit. Deux compositions responsive.**

Mobile et desktop consomment le même contrat produit et le même état de sélection. Ils n'ont pas à reconstruire deux fois la disponibilité, le prix, les médias ou la livraison. Leur différence appartient au rendu : mobile vertical, tactile et plein écran ; desktop galerie + Buy Box premium.

---

## 2. Problème que cette doctrine interdit de recréer

Au 2026-07-12, le code porte plusieurs responsabilités au mauvais étage :

- `b-modal-core.js` lit directement un produit de `state.products` et rend lui-même nom, prix, promotion et stock ;
- `b-modal-product.js` déduit l'indisponibilité depuis `opt.stock` axe par axe et modifie carousel/prix à partir des variantes ;
- `b-modal-desktop-enhancers.js` reconstruit encore prix, stock, livraison, paiement et trust depuis le produit brut ;
- `modal-view-model.js` annonce un contrat d'affichage stable mais sert principalement à poser des classes CSS ;
- le mobile et le desktop portent chacun des libellés/délais de livraison codés dans le frontend ;
- `NormalizedSupplierProduct` v1 est plat et ne peut pas préserver explicitement médias riches, axes d'options et unités vendables fournisseur lorsqu'ils existent.

Le résultat n'est pas un gros bug unique. C'est une **dispersion de l'intelligence produit**. Chaque nouveau besoin — SKU croisé, mises en scène, Express, média par couleur — pousse alors à ajouter une condition dans la modal.

Cette doctrine ferme cette voie.

---

## 3. Les quatre étages et leurs responsabilités

| Étage | Possède | Ne fait jamais |
|---|---|---|
| **Connecteurs + contrat source normalisé** | encaisser la source fournisseur, préserver les faits connus et le brut | inventer une combinaison SKU, aplatir une structure riche connue, produire une UI |
| **Raffinerie / catalogue canonique** | normaliser, enrichir, qualifier et persister PRODUCT + MEDIA + OPTIONS + SKU | décider d'un rail client, calculer une disponibilité Express, produire des classes CSS ou un layout modal |
| **Moteurs métier + contrat détail** | résoudre stock SKU, prix commercial, options de livraison commercialisables ; composer une projection publique stable | réécrire les faits source, dépendre du viewport, rendre du HTML |
| **Modal / état de sélection** | gérer la sélection utilisateur et rendre le contrat | lire les tables métier, deviner un stock, inventer un délai, décider d'un rail, connaître un fournisseur |

### 3.1 Connecteurs : préserver avant de raffiner

Le contrat fournisseur normalisé doit pouvoir préserver, **si la source les fournit** :

- `media[]` : images produit et mises en scène identifiées ;
- `option_axes[]` : couleur, taille, pointure ou autre axe source ;
- `sellable_units[]` : unités fournisseur réellement vendables, avec référence fournisseur, valeurs d'options, stock source et médias associés éventuels.

Règle absolue : une source riche ne doit pas être aplatie en `image_url + stock_available` puis reconstruite plus tard par heuristique.

Une source pauvre reste pauvre honnêtement. La raffinerie n'invente pas une matrice couleur × taille absente de la source.

### 3.2 Raffinerie : produire des faits canoniques

Le catalogue canonique distingue :

```text
PRODUCT
MEDIA
OPTION_AXES
SKU
```

- `products` porte l'identité commerciale commune du produit ;
- les médias portent leur rôle et leurs associations connues ;
- `product_variants` décrit les axes et valeurs disponibles pour guider la sélection ;
- `product_skus` porte les unités vendables et, en mode `SKU`, la vérité de stock.

Doctrine SKU : **une unité vendable = un SKU**. Une couleur ou une taille seule ne porte pas une vérité de stock concurrente.

La raffinerie peut proposer et préparer ces faits. Elle ne connaît ni le bouton « Acheter », ni la grille desktop, ni le swipe mobile.

### 3.3 Moteurs métier : résoudre, pas présenter

Les vérités dynamiques restent chez leur autorité :

- **stock / unité vendable** : catalogue via `product_skus` et le modèle d'inventaire explicite ;
- **prix** : `economic-engine` et les champs commerciaux publiés ;
- **rails / éligibilité / routing** : `logistics` ;
- **valorisation commerciale d'un rail** : `economic-engine`.

Le catalogue peut projeter une éligibilité ou une option déjà résolue. Il ne promet jamais un rail, un prix de transport ou un délai en les déduisant lui-même.

### 3.4 Contrat détail : assembler sans réinventer

Le contrat détail produit est une **projection publique composée**, pas un nouveau moteur métier.

Il assemble uniquement des faits et résultats déjà possédés par les autorités ci-dessus.

Cible conceptuelle :

```text
product_detail
├── identity
├── pricing
├── media
├── option_axes
├── sellable_units
├── delivery_options
└── presentation_hints
```

`presentation_hints` reste limité aux informations éditoriales publiques utiles au rendu : labels, rôle d'un média, ordre d'affichage. Il ne contient jamais de règle CSS, breakpoint ou décision métier.

---

## 4. Contrat public cible

La forme exacte est versionnée par schéma/contrat API. La sémantique suivante est normative :

```json
{
  "contract_version": "1",
  "product": {
    "id": "uuid",
    "reference": "ROB-001",
    "name": "Robe Dubaï",
    "description": "...",
    "category": "vetements"
  },
  "pricing": {
    "price_kmf": 12500,
    "old_price_kmf": 15000,
    "promo_pct": 17
  },
  "media": [
    {
      "id": "media-1",
      "url": "...",
      "role": "SCENE",
      "alt": "...",
      "option_values": { "Couleur": "Marron" }
    }
  ],
  "option_axes": [
    {
      "key": "Couleur",
      "display_name": "Couleur",
      "values": [
        { "value": "Marron", "thumbnail_url": "..." },
        { "value": "Beige", "thumbnail_url": "..." }
      ]
    },
    {
      "key": "Taille",
      "display_name": "Taille",
      "values": [
        { "value": "S" },
        { "value": "M" },
        { "value": "L" }
      ]
    }
  ],
  "sellable_units": [
    {
      "sku_id": "uuid",
      "sku": "ROB-001-MAR-M",
      "option_values": { "Couleur": "Marron", "Taille": "M" },
      "stock_status": "AVAILABLE",
      "available_quantity": 4,
      "price_kmf": 12500,
      "media_ids": ["media-1"]
    },
    {
      "sku_id": "uuid",
      "sku": "ROB-001-MAR-L",
      "option_values": { "Couleur": "Marron", "Taille": "L" },
      "stock_status": "OUT_OF_STOCK",
      "available_quantity": 0,
      "price_kmf": 12500,
      "media_ids": ["media-1"]
    }
  ],
  "delivery_options": [
    {
      "code": "SEA_STANDARD",
      "label": "Livraison standard",
      "available": true,
      "price_kmf": 0,
      "eta_label": "...",
      "unavailable_reason": null
    }
  ]
}
```

### Règles de contrat

1. `sellable_units` contient des unités réelles, jamais un produit cartésien inventé.
2. `sku_id` est la référence transactionnelle de l'unité vendable.
3. `option_axes` décrit les choix ; il ne porte pas de stock autonome.
4. Les médias peuvent être globaux ou associés à des valeurs d'options/SKU connues.
5. `delivery_options` contient uniquement des options **commercialement exposables**.
6. Une option indisponible peut être présente avec une raison explicite uniquement si le métier a décidé qu'il est utile de l'expliquer au client.
7. Aucun délai générique de livraison n'est inventé dans le frontend.
8. Aucun champ de cuisine raffinerie ne traverse cette frontière publique.

---

## 5. Livraison Standard / Express

La fiche produit cible sait afficher plusieurs options de livraison, notamment Standard et Express. Elle ne possède pas ces concepts en dur.

La règle est :

```text
logistics connaît le rail
        ↓
economic-engine le valorise
        ↓
projection commerciale détermine ce qui est exposable
        ↓
product_detail.delivery_options
        ↓
modal rend
```

Conséquence actuelle : `AIR_EXPRESS` est connu du système mais `INTERNAL / PENDING / DISABLED`. Il ne doit donc pas apparaître comme promesse client tant que la doctrine Transport Rails ne le rend pas commercialement exposable.

Quand `AIR_EXPRESS` devient public et valorisé, le contrat peut exposer une seconde entrée. **La modal ne change pas de doctrine ni de structure métier pour l'afficher.**

Le frontend ne transforme jamais `absence d'Express` en « Express indisponible ». Il rend exactement la projection reçue.

---

## 6. État de sélection produit

La modal possède un **état de sélection**, pas une logique de stock.

Entrées :

```text
product_detail
selection = { Couleur: "Marron" }
```

Sortie pure :

```text
selected_sku_id
selected_media
option_values[] avec AVAILABLE | OUT_OF_STOCK | INCOMPATIBLE
selection_message éventuel
```

Exemple :

```text
Couleur = Marron
Taille L = OUT_OF_STOCK
message = "L indisponible pour Marron — rupture de stock"
```

Cette réduction doit vivre dans **un seul owner de sélection** partagé par mobile et desktop. Le renderer ne boucle pas sur une matrice pour inventer la disponibilité ; il consomme l'état dérivé des `sellable_units` explicites.

Le calcul est déterministe et frontend-safe parce qu'il ne décide d'aucune vérité métier : il filtre une liste d'unités déjà qualifiées par le backend.

### Interdit

- `_buildSizeGrid()` ne décide plus seul que `opt.stock === 0` représente la disponibilité d'une taille indépendamment de la couleur ;
- le mobile et le desktop ne possèdent pas deux reducers de sélection ;
- `variant_combo` n'est pas utilisé comme canal de stock dans la modal cible ;
- « première option disponible » ne doit jamais masquer un choix utilisateur déjà explicite.

---

## 7. Doctrine de la modal enrichie

La modal produit est la **fiche produit transactionnelle de Komerce** pour le catalogue vivant.

Elle concentre :

- découverte visuelle et mises en scène ;
- identité, prix et promotion ;
- sélection visuelle des options ;
- compréhension immédiate des indisponibilités ;
- modes de livraison commercialement exposés ;
- quantité ;
- Ajouter / Acheter ;
- enrichissements éditoriaux et suggestions selon le viewport.

Elle reste distincte de la fiche snapshot lecture seule du panier partagé.

### Mobile

- plein écran ;
- parcours vertical ;
- galerie swipe ;
- compteur média ;
- vignettes couleur avec image produit quand le contrat en fournit ;
- sélection tactile compacte ;
- indisponibilité expliquée ;
- actions visibles/sticky.

### Desktop

- galerie / médias à gauche ;
- Buy Box à droite ;
- mêmes SKU, mêmes options, même disponibilité et mêmes options de livraison que le mobile ;
- détails et enrichissements éditoriaux adaptés à l'espace desktop.

Le desktop n'est pas un mobile élargi. Le mobile n'est pas un desktop amputé.

---

## 8. Ownership cible

| Responsabilité | Owner cible |
|---|---|
| Contrat source fournisseur versionné | `services/suppliers/normalized-product.js` + `schemas/catalog/*` |
| Normalisation / enrichissement | raffinerie catalogue |
| Unités vendables / stock | `product_skus` + services catalog propriétaires |
| Rails / éligibilité transport | `logistics` |
| Valorisation rail | `economic-engine` |
| Projection publique produit | service catalog dédié de détail produit |
| État de sélection produit | ViewModel/reducer modal unique |
| Orchestration open/close/fetch | `b-modal-core.js` |
| Rendu contenu produit | `b-modal-product.js` |
| Médias / carousel / fullscreen | `b-modal-image-ux.js` |
| Composition desktop | `b-modal-desktop-enhancers.js` uniquement pour le layout/enrichissement desktop, jamais pour recalculer stock/prix/livraison |
| CSS modal | owners `modal-shell.css`, `modal-media.css`, `modal-product.css`, extension desktop déclarée |

`modal-view-model.js` doit évoluer de « poseur de classes contractuelles » vers **owner du contrat d'affichage et de l'état dérivé de sélection**, ou être remplacé explicitement par un couple `product-detail-view-model` + `product-selection-state`. Il ne doit pas rester un décor au-dessus d'un rendu qui continue à lire le produit brut.

La décision d'extraction se prend au Lot 2 après audit des tests ; aucune seconde abstraction parallèle n'est créée sans déprécier l'ancienne.

---

## 9. Interdictions

- Ne jamais mettre de logique de fournisseur dans la modal.
- Ne jamais mettre de logique de swipe, breakpoint ou CSS dans la raffinerie.
- Ne jamais coder `STANDARD` / `EXPRESS` comme liste fixe dans le frontend.
- Ne jamais coder un délai universel « 3 à 5 semaines » dans la modal.
- Ne jamais reconstruire un stock couleur × taille depuis deux stocks d'axes.
- Ne jamais exposer `product_skus` brut sans projection publique whitelistée.
- Ne jamais créer un « product detail composer » qui recalcule pricing, routing ou éligibilité : il assemble des résultats propriétaires.
- Ne jamais conserver durablement deux chemins de rendu, l'un sur le produit brut et l'autre sur le ViewModel.
- Ne jamais réutiliser la modal catalogue pour la fiche snapshot du panier partagé.

---

## 10. Séquencement de refactor

### Lot PDC-0 — Doctrine et cartes

- acter cette frontière ;
- aligner `BOUTIQUE_ARCHITECTURE.md`, `BOUTIQUE_MODAL_ARCHITECTURE.md`, cartes `catalog` et `modal-product` ;
- aucune modification comportementale.

### Lot PDC-1 — Préservation source riche

- versionner le contrat fournisseur suivant ;
- préserver `media[]`, `option_axes[]`, `sellable_units[]` quand présents ;
- adapter les connecteurs sans inventer de données ;
- fixtures « source riche » et « source pauvre ».

### Lot PDC-2 — Contrat détail backend

- créer la projection publique détail produit ;
- exposer médias, axes et `sellable_units` depuis le modèle SKU ;
- brancher une projection `delivery_options` consommant seulement les rails commercialement exposables et valorisés ;
- schéma/contrat API + tests.

### Lot PDC-3 — État de sélection unique

- faire du ViewModel/reducer unique l'owner de la sélection ;
- couleur → tailles disponibles dérivées des `sellable_units` ;
- SKU sélectionné explicite ;
- média sélectionné dérivé du contrat ;
- tests purs exhaustifs sur combinaisons et ruptures.

### Lot PDC-4 — Modal mobile

- brancher le mock cible sur le contrat ;
- vignettes photo couleur ;
- galerie/mises en scène ;
- taille combo-aware + raison d'indisponibilité ;
- options de livraison reçues ;
- actions sticky ;
- aucune règle métier locale.

### Lot PDC-5 — Modal desktop

- même contrat et même état de sélection ;
- galerie + Buy Box ;
- supprimer les reconstructions prix/stock/livraison dans `b-modal-desktop-enhancers.js` ;
- conserver uniquement les enrichissements réellement desktop.

### Lot PDC-6 — Extinction legacy modal

- `b-modal-core.js` ne rend plus les champs métier depuis le produit liste brut ;
- suppression des délais/livraisons hardcodés ;
- suppression du double pilotage classes legacy / ViewModel ;
- audit final : un seul owner par vérité.

### Lot PDC-7 — Extinction stock legacy

Ce lot reste dépendant du chantier SKU et de sa couverture mesurée. Il ne supprime `products.stock` / `product_variants.stock` comme vérité que lorsque la bascule SKU est complète selon `DECISION_MODELE_STOCK_SKU.md`.

---

## 11. Définition de « terminé »

Le chantier est terminé quand :

1. une source fournisseur riche peut traverser l'ingestion sans perdre médias/options/unités vendables connus ;
2. `GET` détail produit expose un contrat public versionné et whitelisté ;
3. la sélection Marron + L peut être expliquée comme indisponible à partir d'un SKU réel, sans stock par axe ;
4. mobile et desktop consomment le même état de sélection ;
5. aucune modal ne code un délai de livraison universel ni une liste fixe Standard/Express ;
6. `AIR_EXPRESS` n'apparaît au client que lorsque `logistics` + `economic-engine` l'autorisent commercialement ;
7. `b-modal-desktop-enhancers.js` n'est plus un second moteur de prix/stock/livraison ;
8. la fiche snapshot shared-cart reste séparée ;
9. les cartes feature-first, headers `@komerce-arch`, contrats API et gates reflètent les owners réels.

---

## 12. Phrase de revue

Toute PR de ce chantier doit pouvoir répondre en une phrase :

> **Est-ce que je préserve un fait, résous une vérité métier, compose un contrat public ou rends une interaction ?**

Si la réponse mélange deux de ces verbes dans le même composant sans ownership explicite, la PR doit être re-découpée avant merge.
