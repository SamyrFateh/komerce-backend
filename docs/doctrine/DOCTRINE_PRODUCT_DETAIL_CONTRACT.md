# Doctrine du contrat détail produit Komerce

> **Version** : 1.1 — 2026-07-12
> **Statut** : doctrine active — frontière canonique entre catalogue, moteurs métier et fiche produit
> **Feature propriétaire** : `catalog`
> **Endpoint public v1** : `GET /api/products/:id/detail`
> **Schéma** : `schemas/catalog/product-detail.v1.schema.json`
> **Code porteur** : `services/catalog-product-detail.js`, `routes/catalog-product-detail.js`
> **Consommateurs** : `modal-product`, `orders`, `recommendations`
> **Contributeurs de vérité** : `catalog`, `logistics`, `economic-engine`
> **Documents liés** : `DOCTRINE_CATALOGUE.md`, `DOCTRINE_INGESTION_CATALOGUE.md`, `DOCTRINE_TRANSPORT_RAILS.md`, `docs/specs/DECISION_MODELE_STOCK_SKU.md`, `docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md`

---

## 1. Phrase de vérité

> **La raffinerie préserve et raffine les faits produit. Les moteurs métier résolvent les vérités dynamiques. Le contrat détail compose l'état commercial. La modal sélectionne et rend.**

Corollaire UX :

> **Une intelligence produit. Deux compositions responsive.**

Mobile et desktop consomment le même contrat produit et, au terme de PDC-3, le même état de sélection. Leur différence appartient au rendu : mobile vertical, tactile et plein écran ; desktop galerie + Buy Box premium.

---

## 2. Le problème interdit

La modal ne doit jamais redevenir l'endroit où l'on rassemble des bouts de données brutes puis où l'on « devine » le produit :

- stock couleur puis stock taille ;
- image supposée appartenir à une couleur ;
- délai générique de livraison ;
- Express déduit dans le frontend ;
- ancien prix reconstruit localement ;
- comportement mobile et desktop divergent parce qu'ils recalculent chacun leur état.

Le problème architectural historique n'était pas un bug isolé. C'était une **dispersion de l'intelligence produit** entre `b-modal-core.js`, `b-modal-product.js`, `b-modal-desktop-enhancers.js` et un `ModalViewModel` qui ne possédait pas réellement l'état de la fiche.

Cette doctrine ferme cette voie.

---

## 3. Les quatre étages

| Étage | Possède | Ne fait jamais |
|---|---|---|
| **Connecteurs + contrat source** | encaisser la source, préserver le brut et les faits connus | inventer une combinaison SKU, aplatir une structure riche, produire une UI |
| **Raffinerie / catalogue canonique** | normaliser, enrichir, qualifier et persister PRODUCT + MEDIA + OPTION_AXES + SKU | décider d'un rail client, produire des classes CSS ou un layout modal |
| **Moteurs métier + contrat détail** | résoudre les vérités propriétaires puis composer une projection publique stable | réécrire les faits source, dépendre du viewport, rendre du HTML |
| **Modal / état de sélection** | sélectionner et rendre | lire les tables métier, deviner un stock, inventer un délai, décider d'un rail |

### 3.1 Préserver avant de raffiner

Le contrat fournisseur V2 préserve, lorsque la source les fournit explicitement :

```text
media[]
option_axes[]
sellable_units[]
```

Une source riche ne doit pas être réduite à `image_url + stock_available` puis reconstruite plus tard.

Une source pauvre reste pauvre honnêtement. Aucun produit cartésien couleur × taille n'est inventé.

### 3.2 Le catalogue canonique

La cible distingue :

```text
PRODUCT
MEDIA
OPTION_AXES
SKU
```

- `products` porte l'identité commerciale commune ;
- les médias portent leur rôle et leurs associations connues ;
- `product_variants` décrit les axes et valeurs de sélection ;
- `product_skus` porte les unités vendables et, en mode `SKU`, la vérité de stock.

> **Une unité vendable = un SKU.**

Une couleur ou une taille seule ne porte jamais une vérité de stock concurrente dans le modèle cible.

### 3.3 Les moteurs métier

Les vérités dynamiques restent chez leur autorité :

- stock / unité vendable : `catalog` via `product_skus` et `inventory_model` ;
- prix produit : champs commerciaux publiés et `economic-engine` ;
- rail / éligibilité / routing : `logistics` ;
- valorisation transport : `economic-engine`.

Le contrat détail **assemble**. Il ne devient pas un nouveau pricing engine, un routeur logistique ou un moteur de stock.

---

## 4. Contrat public v1 matérialisé

Le contrat public v1 est servi par :

```text
GET /api/products/:id/detail
```

et validé avant sortie par :

```text
schemas/catalog/product-detail.v1.schema.json
```

Structure :

```text
product_detail_v1
├── contract_version
├── inventory_model
├── product
├── pricing
├── media
├── option_axes
├── sellable_units
└── delivery_options
```

Exemple conceptuel :

```json
{
  "contract_version": "1",
  "inventory_model": "SKU",
  "product": {
    "id": "uuid",
    "reference": "ROB-001",
    "name": "Robe Dubaï",
    "description": "...",
    "category": "vetements",
    "subcategory": "robes"
  },
  "pricing": {
    "price_kmf": 12500,
    "old_price_kmf": null,
    "promo_pct": 17
  },
  "media": [
    {
      "id": "variant-1-1",
      "url": "...",
      "role": "PRODUCT",
      "alt": "Robe Dubaï",
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
        { "value": "M", "thumbnail_url": null },
        { "value": "L", "thumbnail_url": null }
      ]
    }
  ],
  "sellable_units": [
    {
      "sku_id": "uuid",
      "sku": "ROB-MAR-M",
      "option_values": { "Couleur": "Marron", "Taille": "M" },
      "stock_status": "AVAILABLE",
      "available_quantity": 4,
      "price_kmf": 12500,
      "media_ids": ["variant-1-1"]
    },
    {
      "sku_id": "uuid",
      "sku": "ROB-MAR-L",
      "option_values": { "Couleur": "Marron", "Taille": "L" },
      "stock_status": "OUT_OF_STOCK",
      "available_quantity": 0,
      "price_kmf": 12500,
      "media_ids": ["variant-1-1"]
    }
  ],
  "delivery_options": [
    {
      "code": "SEA_STANDARD",
      "label": "Livraison standard",
      "available": true,
      "price_kmf": null,
      "eta_label": null,
      "unavailable_reason": null
    }
  ]
}
```

### Règles du contrat

1. `sellable_units` contient des unités réelles, jamais un produit cartésien inventé.
2. `sku_id` est la référence transactionnelle de l'unité vendable.
3. `option_axes` décrit les choix et ne porte aucun stock autonome.
4. Les médias peuvent être globaux ou associés à des valeurs d'options explicites.
5. `delivery_options` contient uniquement des options déjà commercialement exposables.
6. Aucun champ de cuisine raffinerie ne traverse la frontière publique.
7. Toute réponse est validée par le schéma v1 avant sortie.
8. Un contrat invalide échoue bruyamment avec `PRODUCT_DETAIL_CONTRACT_INVALID`.

---

## 5. Sources canoniques du contrat v1

Le contrat v1 actuel projette **uniquement les structures canoniques existantes** :

| Bloc public | Source actuelle |
|---|---|
| `product` | `products` |
| `pricing` | champs commerciaux publiés de `products` / prix SKU explicite |
| `media` | `products.image_url`, `products.images`, médias explicites de `product_variants` |
| `option_axes` | `product_variants` |
| `sellable_units` | `product_skus` uniquement si `inventory_model = 'SKU'` |
| `delivery_options` | rails retournés par `logistics.listCommercialTransportRails()` |

### 5.1 Ce que PDC-2 ne fait volontairement pas

PDC-1 conserve la richesse fournisseur V2 dans `sourcing_candidates.normalized_source_contract`. PDC-2 **ne lit pas ce snapshot directement pour le servir au client**.

Pourquoi :

```text
source normalisée ≠ catalogue canonique ≠ contrat public
```

Brancher la fiche produit directement sur le snapshot source recréerait précisément le couplage que nous voulons supprimer.

La promotion explicite :

```text
normalized_source_contract
        ↓
PRODUCT / MEDIA / OPTION_AXES / SKU
```

reste un chantier catalogue distinct. Tant qu'elle n'est pas matérialisée, les rôles riches source comme `SCENE` ne sont pas inventés dans le contrat public.

Les médias canoniques existants sont honnêtement projetés avec le rôle `PRODUCT`. Aucune image n'est déclarée « mise en scène » depuis son nom de fichier, son ordre ou une analyse visuelle.

---

## 6. Produits legacy pendant la migration SKU

Pour :

```text
inventory_model = LEGACY_VARIANTS
```

le contrat v1 peut exposer les `option_axes` descriptifs, mais :

```text
sellable_units = []
```

Il est interdit de reconstruire de fausses unités vendables depuis :

```text
stock Couleur
+
stock Taille
```

La migration vers `SKU` reste explicite et atomique conformément à `DECISION_MODELE_STOCK_SKU.md`.

PDC-3 doit connaître `inventory_model` et ne jamais prétendre disposer d'une sélection SKU autoritaire pour un produit encore legacy.

---

## 7. Média et association aux unités

Le contrat v1 ne devine pas les associations média.

Aujourd'hui, lorsqu'une ligne `product_variants` porte explicitement un média pour :

```text
Couleur = Marron
```

le média public porte :

```json
{ "option_values": { "Couleur": "Marron" } }
```

Un SKU :

```text
Marron + M
```

peut alors référencer ce média parce que l'association explicite `{Couleur:Marron}` est un sous-ensemble exact de ses `option_values`.

Ce filtrage est déterministe. Il ne dépend ni du filename, ni d'une couleur dominante, ni de la position du média.

---

## 8. Livraison Standard / Express

La chaîne reste :

```text
logistics connaît le rail
        ↓
economic-engine le valorise
        ↓
projection commerciale décide ce qui est exposable
        ↓
product_detail.delivery_options
        ↓
modal rend
```

### État réel au 2026-07-12

- `SEA_STANDARD` : commercialement exposable ;
- `AIR_EXPRESS` : `INTERNAL / PENDING / DISABLED`.

Le contrat détail appelle uniquement `listCommercialTransportRails()`.

Conséquence :

```text
delivery_options = [SEA_STANDARD]
```

aujourd'hui.

`AIR_EXPRESS` n'est pas transformé en « Express indisponible ». Il est absent de la projection publique tant qu'il n'est pas commercialisable.

### Prix et délai actuels

Aucun service propriétaire ne fournit encore un devis public produit/destination stabilisé pour :

```text
price_kmf
eta_label
```

Le contrat retourne donc honnêtement :

```json
{
  "price_kmf": null,
  "eta_label": null
}
```

Il est interdit de remplacer ces `null` par :

```text
Gratuit
3 à 5 semaines
```

codés dans le frontend.

Quand `AIR_EXPRESS` devient public **et** qu'une projection commerciale fournit prix/délai, une seconde entrée apparaît dans `delivery_options`. La modal ne change pas de doctrine.

Un rail nouvellement commercial sans wording public explicite fait échouer la composition avec `PRODUCT_DETAIL_RAIL_LABEL_MISSING` au lieu d'afficher un code technique ou un label inventé.

---

## 9. État de sélection produit — cible PDC-3

La modal possède un **état de sélection**, pas une logique de stock.

Entrées :

```text
product_detail
selection = { Couleur: "Marron" }
```

Sortie pure :

```text
selected_options
selected_sku_id
selected_media
option_states
selection_message
```

États d'option :

```text
AVAILABLE
OUT_OF_STOCK
INCOMPATIBLE
```

Exemple :

```text
Couleur = Marron
Taille L = OUT_OF_STOCK
message = "L indisponible pour Marron — rupture de stock"
```

Cette réduction vit dans **un seul owner partagé mobile/desktop**.

Le calcul est déterministe : il filtre les `sellable_units` déjà qualifiées. Il ne décide d'aucune vérité métier.

### Interdit

- `_buildSizeGrid()` décide seul qu'une taille est disponible via `opt.stock` ;
- mobile et desktop possèdent deux reducers ;
- `variant_combo` redevient le canal de stock de la modal cible ;
- « première option disponible » masque un choix utilisateur explicite ;
- un produit legacy est présenté comme SKU-ready parce qu'il a des axes.

---

## 10. Doctrine de la modal enrichie

La modal est la **fiche produit transactionnelle de Komerce** pour le catalogue vivant.

Elle concentre :

- découverte visuelle et mises en scène quand le catalogue les connaît ;
- identité, prix et promotion ;
- sélection visuelle des options ;
- compréhension immédiate des indisponibilités ;
- modes de livraison commercialement exposés ;
- quantité ;
- Ajouter / Acheter ;
- enrichissements éditoriaux et suggestions.

Elle reste distincte de la fiche snapshot lecture seule du panier partagé.

### Mobile

- plein écran ;
- parcours vertical ;
- galerie swipe ;
- compteur média ;
- vignettes couleur photo quand fournies ;
- sélection tactile compacte ;
- indisponibilité expliquée ;
- actions visibles/sticky.

### Desktop

- galerie / médias à gauche ;
- Buy Box à droite ;
- mêmes SKU, mêmes options, mêmes disponibilités et mêmes `delivery_options` ;
- détails et enrichissements adaptés à l'espace desktop.

Le desktop n'est pas un mobile élargi. Le mobile n'est pas un desktop amputé.

---

## 11. Ownership cible

| Responsabilité | Owner |
|---|---|
| Contrat source fournisseur | `services/suppliers/normalized-product.js` + `schemas/catalog/*` |
| Normalisation / enrichissement | raffinerie catalogue |
| Unités vendables / stock | `product_skus` + services catalog propriétaires |
| Rails / exposition commerciale | `logistics` |
| Valorisation transport | `economic-engine` |
| Projection détail public | `services/catalog-product-detail.js` |
| Façade HTTP détail | `routes/catalog-product-detail.js` |
| État de sélection | ViewModel/reducer modal unique — PDC-3 |
| Open/close/fetch modal | `b-modal-core.js` |
| Rendu produit | `b-modal-product.js` |
| Média / carousel / fullscreen | `b-modal-image-ux.js` |
| Composition desktop | `b-modal-desktop-enhancers.js`, sans recalcul stock/prix/livraison |

`modal-view-model.js` doit évoluer vers l'owner réel du contrat d'affichage et de l'état dérivé de sélection, ou être remplacé explicitement par un couple ViewModel/reducer. Aucune abstraction parallèle durable n'est autorisée.

---

## 12. Interdictions

- Logique fournisseur dans la modal.
- Swipe, breakpoint ou CSS dans la raffinerie.
- Liste fixe Standard/Express dans le frontend.
- Délai universel « 3 à 5 semaines » dans la modal.
- Reconstruction d'un stock couleur × taille depuis deux stocks d'axes.
- Exposition brute de `product_skus` ou `normalized_source_contract`.
- « Product detail composer » qui recalcule pricing, routing ou éligibilité.
- Deux chemins durables de rendu : produit brut et ViewModel.
- Réutilisation de la modal catalogue pour le snapshot shared-cart.
- Lecture publique directe du snapshot fournisseur V2.
- Ancien prix reconstitué depuis `promo_pct` lorsque la source canonique ne le fournit pas.

---

## 13. Séquencement

### PDC-0 — Doctrine et cartes

Frontière actée.

### PDC-1 — Préservation source riche

Contrat fournisseur V2 + snapshot normalisé séparé du brut.

### PDC-2 — Contrat détail backend

**Matérialisé par le contrat v1 et `GET /api/products/:id/detail`.**

- données canoniques uniquement ;
- axes descriptifs ;
- SKU réels uniquement en mode `SKU` ;
- médias associés par faits explicites ;
- rails déjà commercialement exposés ;
- aucun prix/délai transport inventé.

### PDC-3 — État de sélection unique

- reducer/ViewModel unique ;
- couleur → tailles dérivées des `sellable_units` ;
- SKU sélectionné explicite ;
- média courant dérivé ;
- tests purs exhaustifs.

### PDC-4 — Modal mobile

Mock cible branché sur contrat + état de sélection.

### PDC-5 — Modal desktop

Même contrat et même état ; galerie + Buy Box ; suppression des reconstructions métier desktop.

### PDC-6 — Extinction legacy modal

`b-modal-core.js` ne rend plus les vérités transactionnelles depuis le produit liste brut ; suppression des délais et livraisons hardcodés ; un seul owner par vérité.

### PDC-7 — Extinction stock legacy

Dépend de la couverture SKU mesurée et de `DECISION_MODELE_STOCK_SKU.md`.

---

## 14. Définition de « terminé »

Le chantier complet est terminé quand :

1. une source riche traverse l'ingestion sans perdre les faits connus ;
2. le détail produit expose un contrat public versionné et validé ;
3. Marron + L peut être expliqué comme indisponible depuis un SKU réel ;
4. mobile et desktop consomment le même état de sélection ;
5. aucune modal ne code un délai universel ni une liste Standard/Express ;
6. `AIR_EXPRESS` n'apparaît que lorsque les moteurs propriétaires l'exposent ;
7. `b-modal-desktop-enhancers.js` n'est plus un moteur parallèle ;
8. le snapshot shared-cart reste séparé ;
9. cartes, headers, contrats API et gates reflètent les owners réels.

---

## 15. Phrase de revue

Toute PR de ce chantier doit répondre en une phrase :

> **Est-ce que je préserve un fait, résous une vérité métier, compose un contrat public ou rends une interaction ?**

Si la réponse mélange deux de ces verbes dans le même composant sans ownership explicite, la PR est re-découpée avant merge.
