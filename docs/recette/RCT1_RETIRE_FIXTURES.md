# Retrait des fixtures RCT1 du catalogue (2026-10-31)

**Décision.** RCT1 n'est pas une source de produits vendables. Les vrais produits du sourcing restent seuls dans le parcours commercial. Les tests métier (prix, stock, douane, routage, remboursements) restent dans le dépôt et se jouent sur PostgreSQL jetable.

## Portée du retrait staging
- Cinq produits exacts : `RCT1-P1`, `RCT1-P2`, `RCT1-P3`, `RCT1-P4`, `RCT1-P5`.
- Désactivation `is_active=false` **et** `is_available=false` via le service catalogue, atomiquement. Les produits disparaissent de la vente et des listes marché actives.
- Aucune suppression physique de `orders`, `order_items`, paiements, colis, logs de scans ni écritures financières RCT1 : conservation de la traçabilité et du référentiel des tests. Les comptes et relais créés pour la recette demandent une revue de dépendances avant retrait.
- Aucun `TRUNCATE`, `CASCADE`, `DELETE`, ni filtre vague sur `RCT1%` ; références exactes uniquement.
- Si une commande réelle utilise l'un de ces produits, blocage automatique.

## Exécution
La branche `main` doit contenir le script avant lancement. Ouvrir une issue (par le propriétaire du dépôt) dont le titre est **`[staging-op] audit-rct1-fixture-products`** pour recevoir un rapport sans aucune écriture.
Après examen du rapport, ouvrir une issue **`[staging-op] retire-rct1-fixture-products`** pour l'opération atomique. Le workflow compare l'identité DB/Railway, l'empreinte de déploiement, l'origine des cinq produits, l'absence de commandes réelles et l'intégrité du reste de leurs champs. Les artifacts JSON fournissent l'avant/après. Toute anomalie fait ROLLBACK.

**Important.** Les commandes RCT1 historiques restent visibles si l'on choisit explicitement le filtre « simulation RCT1 » ; elles sont déjà exclues de la réalité économique par défaut. Le moteur `rct1` demeure pour les tests et inspections, mais les injections automatiques staging sont désactivées afin d'éviter la recréation des cinq produits. La suppression physique complète des lignes simulées nécessite une cartographie de dépendances distincte.
