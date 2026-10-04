# M2a — Template Komerce pré-rempli

## Principe

Le modèle fichier Komerce n'est pas un tableur vide.

> Tout ce que Komerce peut déterminer sans ambiguïté est généré automatiquement. L'humain ne renseigne que les faits et décisions métier.

Le template est donc une interface métier générée par Komerce.

## Champs système

Pré-remplis et destinés à être protégés dans le writer XLSX :

- source_product_key ;
- media_ref ;
- display_order ;
- supplier_sku pour INTERNAL_STOCK ;
- version/profil ;
- rattachements produit ;
- valeurs globales du profil connues.

## Champs métier

Restent éditables parce que Komerce ne peut pas les inventer :

- product_name ;
- vraie référence fournisseur ;
- catégorie ;
- description ;
- marque ;
- prix d'achat ;
- stock ;
- taille/couleur/autres variantes ;
- poids/dimensions ;
- URL médias.

## Règle fournisseur tiers

Pour SUPPLIER_DIRECT, Komerce ne fabrique jamais supplier_sku.

La référence doit venir du fournisseur ou du métier.

## Règle stock interne

Pour INTERNAL_STOCK, Komerce peut générer une référence SKU interne déterministe, car il est l'autorité d'identité de cette unité.

## Valeurs de profil

Une valeur peut être pré-remplie seulement si elle est réellement définie au niveau du profil :

- currency ;
- source_locale ;
- fulfillment_mode ;
- active par défaut.

Une valeur inconnue reste vide/null. En particulier, stock absent n'est jamais transformé en 0.

## UX XLSX attendue

Le writer M2b devra produire :
- README ;
- PRODUCTS ;
- UNITS ;
- MEDIA ;
- colonnes système protégées ;
- colonnes métier éditables ;
- listes déroulantes ;
- validations numériques ;
- lignes pré-générées ;
- gel des en-têtes ;
- indications obligatoires/optionnelles.

M2a ne génère pas encore le binaire XLSX : il définit le modèle déterministe que tous les writers devront rendre.
