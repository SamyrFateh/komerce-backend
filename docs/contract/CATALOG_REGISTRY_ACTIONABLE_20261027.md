# Catalogue global actionnable — première transformation (2026-10-27)

## Périmètre
Raffinerie et Catalogue ne sont pas fusionnés. La Raffinerie conserve les
travaux amont, les corrections de préparation FR et la validation humaine.
Le Catalogue est le registre consultable des produits **effectivement remis**
par le Sourcing/Raffinerie (état `sourcing_candidates.imported_to_catalog`,
`product_id` lié), y compris les brouillons non vendables.

La projection commerciale de `catalog-commercial-assortment.js` reste
inchangée : seule elle certifie son sous-ensemble issu de KIR clos,
avec exposition ENABLED et prix LOCAL_ACTIVE. Il ne faut pas réutiliser
ce sous-ensemble comme définition du registre global.

## Navigation, filtrage et actions
- Recherche par titre, `product_ref` et identité produit fournisseur ;
  filtres catégorie boutique et sous-catégorie, fournisseur, problème à traiter.
- Pagination et décompte serveur indépendants de la limite d'affichage.
- Diagnostics cumulatifs : source, classification boutique, préparation FR,
  puis validation Catalogue. Le statut principal est une priorisation
  de lecture, non une nouvelle autorité.
- `Classer` utilise `catalog-product-mutation-service.assignBoutiqueTaxonomy`,
  validant la paire active et préservant `products.category` douanier.
  Cette mutation n'approuve jamais la fiche, ni ne décide l'exposition locale.
- `Compléter / Valider en Raffinerie` ouvre le produit candidat visé et les
  actions humaines existantes ; `Examiner source` ouvre le candidat ciblé
  côté Sourcing, même si sa remise a déjà eu lieu.
- Les catégories et sous-catégories restent administrables, mais dans un
  panneau secondaire afin que les produits occupent la surface principale.

## Autorités et garde-fous
- Aucune nouvelle table, copie marché ou autorisation de vente implicite.
- Pas de modification du raw fournisseur depuis l'interface Catalogue.
- Routes protégées par la garde admin + autorité Catalogue globale existante.
- Pas de mise en production ni de fusion tant que les tests fonctionnels et
  le parcours réel sur staging n'ont pas été validés.

## Écarts restant à fermer avant une recette GO
1. **Renormalisation source complète** : l'écran Sourcing sait corriger ses
   champs autorisés, mais un contrat source V2 réellement manquant réclame
   toujours une opération de renormalisation canonique. Une simple correction
   de champ ne constitue pas un PASS de normalisation.
2. **Complétude détaillée** : médias, SKU/identités d'achat, versions de
   traduction et autres invariants restent contrôlés par
   `catalog-certification.js`. Le tableau actuel montre les premiers écarts
   actionnables, pas une certification exhaustive de chaque ligne.
3. **Audit de décision de classement post-remise** : l'action utilise l'autorité
   Catalogue existante mais doit être enrichie d'une preuve actor/avant/après
   immuable avant d'être déclarée conforme à toute la gouvernance.
4. **Totaux commerciaux exhaustifs** : le sous-ensemble commercial ancien est
   affiché avec un plafond de 200. Son compteur est présenté comme un extrait.
5. **UX production** : vérifier desktop 1440 / mobile 390, parcours FR,
   filtres cumulatifs, retours Product 360, profondeur de lien Sourcing,
   habilitations et tests API sur PostgreSQL réel.
6. **Langues étrangères** : hors périmètre, à traiter après cette refonte.

## Tests d'acceptation
- Un candidat canonique remis et non actif est visible dans Catalogue.
- Un candidat non remis est absent, même s'il est présent en source.
- Le même produit peut apparaître dans plusieurs filtres d'écarts.
- Une correction de taxonomie reste limitée aux paires Boutique actives et
  ne modifie ni le douanier ni les décisions de prix ou exposition.
- Correction FR / validation humaine restent dans le parcours Raffinerie.
- Les produits commercialement approuvés restent un sous-ensemble séparé.
