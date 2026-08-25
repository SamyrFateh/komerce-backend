# LOT 3C — Product 360 Canonical

## 1. Mission

Product 360 répond à une seule question :

> Que savons-nous réellement de ce produit, de ses unités vendables, de sa performance et de sa vérité économique ?

Il s'agit d'une **Entity 360 read-only**. Elle explique et réunit des faits déjà possédés par les domaines métier. Elle ne remplace ni le Catalogue Workspace, ni le Sourcing Workspace, ni le Pricing Workspace.

Doctrine :

- le Dashboard observe ;
- le Workspace agit ;
- le 360 explique ;
- le moteur calcule.

## 2. Identité canonique

URL stable :

`/admin/products/:productRef`

API :

`GET /api/admin/entities/products/:productRef`

`product_ref` est l'identité métier stable Komerce (`KPR-XXXXXX`).

Invariants :

- `products.id` reste une UUID DB technique ;
- l'UUID n'est jamais utilisée dans une URL Product 360 ;
- `products.sku` peut évoluer et n'est pas l'identité durable ;
- Product 360 rejette toute référence qui n'est pas une `product_ref` valide.

## 3. Produit global, activité market-scoped

Le modèle actuel ne possède pas de table `product_market` ou équivalent.

Conséquence : Product 360 **n'invente pas** une disponibilité produit par pays.

Les facettes sont séparées ainsi :

### Globales par nature

- identité catalogue ;
- contenu ;
- lifecycle ;
- variantes ;
- SKU ;
- modèle d'inventaire ;
- prix boutique courant.

### Market-scoped

Filtrées côté serveur par `orders.market_id` à partir des marchés autorisés :

- commandes contenant le produit ;
- quantité vendue ;
- chiffre d'affaires observé ;
- clients distincts **par marché** ;
- coûts estimés persistés ;
- allocations de coûts réels persistées.

Un opérateur pays ne peut pas demander au navigateur d'élargir son scope. Aucun `market_id` client n'est autoritatif.

### Central-only

Réservées à une autorité globale explicite (`dashboard_global_access_grants`) :

- provenance catalogue ;
- sourcing source ;
- mappings fournisseurs ;
- SKU fournisseur ;
- prix achat AED ;
- URL fournisseur ;
- priorité/MOQ ;
- historique de prix ;
- audit de stock.

Aucun secret fournisseur (`api_key_enc`, `api_secret_enc`, etc.) n'est exposé.

## 4. Vérité stock

Le champ `products.inventory_model` est l'autorité.

### `SKU`

La source de vérité du stock est `product_skus`.

`stock_total` = somme des stocks des SKU **actifs** uniquement.

### `LEGACY_VARIANTS`

La source de vérité reste `products.stock`.

Les lignes `product_variants` restent visibles comme description du modèle historique, mais **leurs stocks ne sont jamais additionnés** pour produire `stock_total`.

Raison : les variantes legacy peuvent représenter des axes indépendants (ex. couleur et taille), pas des combinaisons vendables. Les sommer produirait un double comptage.

Product 360 ne déduit jamais le mode SKU de la simple présence de lignes dans `product_skus`.

## 5. Vérité économique

Product 360 ne recalcule aucune marge métier.

Sources :

- `order_item_cost_imputations` pour les coûts/marges estimés déjà persistés ;
- `order_item_real_cost_allocations` pour les allocations de coûts réels déjà persistées.

Valeurs exposées notamment :

- lignes imputées ;
- quantité couverte ;
- CA couvert ;
- coût landed estimé ;
- coût business estimé ;
- marge estimée persistée ;
- marge moyenne persistée ;
- montant de coût réel alloué ;
- nombre de lignes disposant d'allocations réelles.

Product 360 ne fabrique pas de `real_margin_kmf` à partir de ces agrégats. Une marge réelle n'est présentée que lorsqu'un moteur métier propriétaire la certifie.

## 6. Clients distincts

`customers_count` est calculé par marché dans la projection de performance.

Product 360 **ne somme pas** ces compteurs pour construire un total global, car un même client peut acheter le même produit sur plusieurs marchés.

Aucun pseudo-total cross-market n'est présenté sans requête distincte dédiée.

## 7. Facettes V1

Payload top-level :

- `product`
- `scope`
- `summary`
- `inventory`
- `performance`
- `economics`
- `central`
- `timeline`
- `data_quality`

### `product`

Identité catalogue publique à l'admin sans UUID : `product_ref`, nom, catégorie, prix, lifecycle, publication, modèle d'inventaire, poids, etc.

### `inventory`

- modèle d'inventaire explicite ;
- stock total selon la règle §4 ;
- variantes legacy ;
- SKU et `variant_combo`.

### `performance`

Une ligne par marché visible : commandes, quantité, CA, clients distincts, dernière vente.

### `economics`

Agrégats persistés, jamais recalculés dans le navigateur.

### `central`

`visibility = global|restricted`.

Si `restricted`, les données sourcing/audit ne sont pas chargées côté DB.

## 8. Timeline

La timeline est fusionnée et triée côté serveur.

V1 peut inclure :

- création produit ;
- dernière mise à jour catalogue ;
- modifications de prix ;
- événements d'audit stock.

Les descriptions internes des alertes stock ne sont pas publiées : elles peuvent contenir des identifiants techniques. Product 360 ne conserve que les métadonnées nécessaires à la présentation.

## 9. Navigation

Order 360 expose désormais `product_ref` sur ses lignes et fournit le drill :

`Order 360 → Product 360`

Le lien est construit avec `product_ref`, jamais avec `product_id`.

Les actions d'édition restent dans les surfaces propriétaires :

- `/admin/products` — Catalogue Legacy 1 tant que le Catalogue Workspace Canonical n'est pas reconstruit ;
- `/admin/sourcing` — Sourcing ;
- `/admin/pricing` — Pricing.

## 10. Invariants de sécurité et gouvernance

1. aucune UUID produit dans le payload public comme identité de navigation ;
2. aucune autorité marché fournie par le navigateur ;
3. performance et coûts filtrés serveur par MarketScope ;
4. sourcing et audit central-only ;
5. aucun secret fournisseur exposé ;
6. aucune recomputation économique navigateur ;
7. aucun cumul des axes de stock legacy ;
8. aucun cumul naïf des clients distincts cross-market ;
9. aucun import `ProductsView`, `SourcingView` ou `PricingView` dans Canonical ;
10. `/admin/products` reste Legacy 1 jusqu'au Workspace dédié.

## 11. Sources runtime

- `products`
- `product_variants`
- `product_skus`
- `order_items`
- `orders`
- `markets`
- `order_item_cost_imputations`
- `order_item_real_cost_allocations`
- `product_suppliers`
- `suppliers`
- `price_history`
- `alerts`
- `users`

Aucune écriture DB n'est autorisée dans LOT 3C.
