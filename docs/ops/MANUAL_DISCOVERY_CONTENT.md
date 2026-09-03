# Alimentation manuelle — Catalogue, produits locaux et services

## But

Permettre à un opérateur d'alimenter manuellement les trois familles visibles dans la Boutique sans créer de catalogue parallèle :

- `catalog_products` → vrais `products` Komerce ;
- `local_products` → vraies `physical_offers` d'un provider ;
- `services` → vrais `services` d'un provider.

Un produit du catalogue peut aussi déclarer `local_stock` : il reste un `product`, mais devient éligible à `Disponible ici` quand le stock physique local et son exposition le permettent.

Le manifeste n'est **jamais** une source de vérité runtime. Après application, les données vivent dans leurs tables propriétaires. `recommendations` ne reçoit que les références et leur ordre d'exposition.

## Exemple

Partir de :

`docs/ops/manual-discovery-content.example.json`

Les identités sont stables :

- catalogue : `product_ref` obligatoire, utilisé pour l'upsert ;
- provider / produit local / service : UUID explicite obligatoire.

Les données de détail admises pour un produit local ou un service sont actuellement :

- `title`
- `description`
- `zone`
- `image_ref`
- `provider_id` → `provider_name` est résolu par le backend

Ces champs alimentent directement la modale Komerce unique `#k-modal` sur mobile et desktop.

## Validation sans écriture

```bash
node scripts/apply-manual-discovery-content.js docs/ops/manual-discovery-content.example.json
```

C'est le comportement par défaut. Le script valide notamment :

- types et champs connus ;
- UUID et `product_ref` stables ;
- statut/exposition compatibles avec Discovery ;
- ordre Discovery non ambigu ;
- maximum de candidats supporté par le rail courant.

## Application explicite

Deux verrous sont nécessaires :

```bash
MANUAL_DISCOVERY_WRITE_ENABLED=true \
node scripts/apply-manual-discovery-content.js mon-contenu.json --apply
```

Le script :

1. résout le marché actif ;
2. vérifie les catégories Discovery contre `boutique_categories` ;
3. upsert les providers ;
4. crée/met à jour les produits via `product-admin-service` ;
5. alimente le stock local via `local-stock-service` ;
6. upsert les `physical_offers` et `services` ;
7. imprime la valeur finale à configurer côté runtime :

```text
DISCOVERY_RAIL_ENABLED=true
DISCOVERY_RAIL_CANDIDATES=product:<uuid>@Tech,physical_offer:<uuid>@Maison|Bricolage,service:<uuid>@Tech
```

Le script ne modifie pas automatiquement les variables Railway.

## Règles d'exposition

### Produit catalogue dans `Disponible ici`

Il doit avoir :

- un produit catalogue valide ;
- `local_stock.qty_physical >= 0` ;
- `local_stock.expose=true` ;
- une section `discovery`.

Il reste de type `product` et ouvre la fiche produit canonique.

### Produit local tiers

Il reste de type `physical_offer`. Pour être déclaré dans Discovery :

- `status=active` ;
- `expose=true` ;
- provider actif au runtime.

La modale l'identifie comme **Produit local** et propose `Commander`.

### Service local

Il reste de type `service`. Pour être déclaré dans Discovery :

- `status=active` ;
- `expose=true` ;
- provider actif au runtime.

La modale l'identifie comme **Service local** et propose `Demander`.

## Desktop = mobile

La catégorie active est le seul contexte utilisateur. `Disponible ici` est recomposé depuis le même pool backend :

- `Tout` → pool transversal ;
- `Tech` → seulement les cartes portant `Tech` ;
- `Maison` → seulement les cartes portant `Maison` ;
- aucune carte locale → aucun slot vide.

Il n'existe ni filtre local séparé, ni second catalogue, ni seconde modale.
