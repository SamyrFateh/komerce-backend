# M1 — Contrat fichier canonique CSV / XLSX

## But

Définir un contrat riche unique pour les catalogues sans API avant d'écrire les adapters M2.

La règle est :

    CSV / XLSX
    → transport parser
    → ManagedCatalogFileBundle.v1
    → validation structure + références
    → mapping
    → NormalizedSupplierProduct V2
    → Raffinerie

CSV et XLSX ne doivent donc jamais avoir deux sémantiques différentes.

## 1. Pourquoi un bundle tabulaire intermédiaire

Un seul CSV plat ne représente pas proprement à la fois :
- le produit ;
- plusieurs variantes ;
- plusieurs médias ;
- des associations média ↔ variante.

Le contrat M1 sépare trois tables logiques :

    PRODUCTS
    UNITS
    MEDIA

XLSX les représentera naturellement par trois feuilles.

CSV les représentera par trois fichiers logiques ou une enveloppe équivalente au niveau adapter.

Le contrat intermédiaire est indépendant du transport.

## 2. PRODUCTS

Une ligne = un produit source.

Clé obligatoire :

    source_product_key

Cette clé est :
- stable dans le temps ;
- fournie par la source/opérateur ;
- unique dans un batch ;
- la clé de rattachement vers UNITS et MEDIA.

Elle n'est jamais dérivée du nom produit.

Champs principaux :
- product_name ;
- supplier_product_id ;
- supplier_category ;
- description ;
- brand ;
- currency ;
- purchase_price ;
- stock_available ;
- poids/dimensions ;
- source_locale ;
- active.

## 3. UNITS

Une ligne = une unité vendable.

Champs :
- source_product_key ;
- supplier_sku ;
- supplier_unit_ref ;
- option_values ;
- stock_available ;
- purchase_price ;
- currency ;
- supplier_order_identity ;
- active.

Règles :
- supplier_sku est unique dans le bundle ;
- source_product_key doit exister dans PRODUCTS ;
- aucune combinaison d'options n'est inventée ;
- stock absent reste UNKNOWN/null ;
- stock 0 est un fait explicite, jamais équivalent à absent ;
- coût unité absent ne reprend pas silencieusement une valeur arbitraire ;
- supplier_order_identity n'est requise que si le parcours SUPPLIER_DIRECT en a besoin pour être commandable.

## 4. MEDIA

Une ligne = un média source.

Champs :
- source_product_key ;
- media_ref ;
- url ;
- role ;
- alt ;
- option_values ;
- display_order.

Règles :
- media_ref est unique dans un produit ;
- source_product_key doit exister dans PRODUCTS ;
- option_values ne peut référencer que des axes/valeurs réellement observés sur les unités du produit ;
- display_order est un ordre, jamais une sémantique.

## 5. Modes de fulfillment

Le bundle porte :

    SUPPLIER_DIRECT
    INTERNAL_STOCK

Ce champ décrit le fulfillment du lot importé. Il ne devient jamais l'identité du provider.

### SUPPLIER_DIRECT

Après vente, Purchasing peut devoir créer une obligation fournisseur.

### INTERNAL_STOCK

Après vente, aucune nouvelle PO fournisseur n'est créée. Le coût économique vient du stock acquis/produit en amont.

## 6. Idempotence de réimport

M1 fixe les clés, M2 les applique.

Minimum :
- produit : source_product_key ;
- unité : supplier_sku dans le produit/source ;
- média : media_ref dans le produit.

Un rejeu du même batch ne crée jamais de doublon.

Un renommage produit ne crée jamais une nouvelle identité.

Les transitions doivent être explicites :
- create ;
- update ;
- deactivate ;
- stock_to_zero.

La disparition silencieuse d'une ligne d'un fichier ne vaut jamais suppression automatique sans politique explicite.

## 7. Parité CSV / XLSX

À données égales :

    CSV → bundle A
    XLSX → bundle B

doit produire :

    A == B

après normalisation des types et ordre non significatif.

Toute divergence de validation entre CSV et XLSX est un bug de M2.

## 8. Rejets M1

Le bundle est rejeté si :
- source_product_key dupliqué ;
- unit rattachée à un produit inconnu ;
- media rattaché à un produit inconnu ;
- supplier_sku dupliqué ;
- media_ref dupliqué dans un produit ;
- devise invalide ;
- stock négatif ;
- prix <= 0 lorsqu'il est présent ;
- type ou structure non conforme ;
- combinaison option_values incohérente.

Le parser transport ne corrige pas silencieusement ces erreurs.

## 9. Exemple logique

PRODUCTS:

    source_product_key | product_name | currency
    ROBE-001           | Robe lin     | EUR

UNITS:

    source_product_key | supplier_sku | option_values                 | stock_available | purchase_price
    ROBE-001           | ROBE-BEI-M   | {"Couleur":"Beige","Taille":"M"} | 4             | 18.50
    ROBE-001           | ROBE-BEI-L   | {"Couleur":"Beige","Taille":"L"} | 0             | 18.50

MEDIA:

    source_product_key | media_ref | url                             | role
    ROBE-001           | img-1     | https://cdn.example/robe-1.jpg | PRODUCT

Le mapping M2 produira ensuite un NormalizedSupplierProduct V2 exact avec axes dérivés uniquement des unités réellement présentes.

## 10. Definition of Done M1

M1 est terminé quand :
1. le schema ManagedCatalogFileBundle.v1 est versionné ;
2. PRODUCTS / UNITS / MEDIA sont définis ;
3. source_product_key est la clé produit stable ;
4. les clés de réimport sont explicites ;
5. CSV et XLSX doivent converger vers le même bundle ;
6. aucune suppression n'est déduite d'une simple absence ;
7. SUPPLIER_DIRECT et INTERNAL_STOCK restent des modes de fulfillment ;
8. les tests rejettent références orphelines et doublons avant M2.
