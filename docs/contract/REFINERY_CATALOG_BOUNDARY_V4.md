# Frontière Raffinerie → Catalogue V4 (2026-10-28)

> **Historique UI, remplacé le 31 octobre 2026 par [SOURCING_CATALOGUE_MASTER_20261031.md](SOURCING_CATALOGUE_MASTER_20261031.md).** Les anciennes files humaines Raffinerie décrites ci-dessous ne sont plus la cible. Les contrats backend, traces et invariants restent en vigueur.


## Décision métier

1. **Sourcing** sélectionne et remet explicitement les candidats.
2. **Raffinerie** prépare les contenus, vérifie les prérequis, traite les écarts, puis soumet les produits à l'autorité de validation existante. Les brouillons inachevés restent visibles dans ses files. Une présence dans la file de validation n'est pas une certification.
3. **Catalogue global opérateur** présente uniquement les produits finalisés et approuvés. Il ne présente pas les tâches Source, Fiche FR, ni les candidats à valider. Les opérations de taxonomie Boutique restent à leur autorité.
4. **Marchés** définissent la mise en vente locale, les prix actifs et l'exposition. Un produit approuvé au Catalogue n'est pas automatiquement visible en boutique.
5. **Traçabilité** : les remises canoniques, refus et brouillons restent en base. Un filtre de la projection Catalogue ne supprime aucune donnée.

## Implémentation

- `services/refinery-worklist.js` : diagnostic borné en lecture seule du statut `content_source` absent ou non reconnu parmi les brouillons `candidate / is_active = false`. Expose les comptes séparés des brouillons en validation, des brouillons à qualifier et des produits déjà actifs après une remise canonique. Réutilise la projection canonique pour afficher **les produits actifs dont les contrôles restent en défaut** dans une file de réexamen dédiée, sans les désactiver.
- `services/catalog-workspace.js` : `refinery_view=1` ajoute la projection Raffinerie, conserve la certification existante en lecture seule et désactive les lectures inutiles du Catalogue. Aucune mutation supplémentaire.
- `services/catalog-registry.js` : l'option `finalized_only=true` filtre les lignes visibles au Catalogue sur `work_status = catalog_approved`, qui exige source/classification/édition prêtes, `is_active=true` et `lifecycle_status=active`. Le registre historique brut conserve son contrat hors de ce filtre.
- Interface : tableaux, libellés, actions contextualisées et file « source à qualifier » distincte des candidats à valider.

## Important : affichage != retrait de vente

Un produit actif qui devient non conforme n'est **pas automatiquement désactivé ni dépublié** par cette PR. Il peut cesser d'être visible dans la vue administrative « finalisés », mais sa visibilité publique est régie ailleurs. Il faut un parcours **réexamen → décision autorisée → éventuelle suspension par l'autorité de marché**, sans déduction automatique. Cette PR ne prétend pas résoudre ce parcours.

## Étalonnage avant fusion

- Relever les agrégats SQL réels et comparer à la Raffinerie (candidats éligibles, origine éditoriale manquante, anciens produits actifs et rejetés).
- Certifier l'absence de faux positif entre la file d'approbation et la file de qualification.
- Vérifier `registry.finalized_only` sur PostgreSQL réel et l'exposition publique séparément.
- Contrôler droits admin globaux et rejet de `market_id`.
- Certifier Chromium 1440/390 : empty state, liste, filtres, navigation, pagination et actions autorisées.
- Exécuter `npm test` ciblé et gate CI complet. Ne pas fusionner sur `main` ni déployer avant preuve.

## Hors périmètre

- Restructuration des statuts, déclenchement des validations, mutation Catalogue, publication marché, réactivation automatique.
- La file de réexamen est **lecture seule** : l'entrée visible ne modifie pas l'état persistant, ne suspend aucun marché et ne clôt aucune certification. Un futur parcours de décision par l'autorité doit conserver une trace explicite du retour en préparation.
