# Catalogue unique — restauration contrôlée des médias fournisseur (lot 4)

**Décision**: un seul panneau humain (Catalogue global), services et gardes canoniques inchangés. Branche dépendante des lots #3136 → #3137 → #3138. **Aucune fusion, migration live ou écriture staging.**

## Cas pris en charge

Un produit déjà remis au Catalogue, mais encore `candidate` et inactif, peut avoir zéro média dans `catalog_media` alors que le snapshot fournisseur `normalized_source_contract` contient des médias V2 avec identités stables et HTTPS.

L’opérateur voit la distinction réelle entre :
- média canonique actif (certification possible);
- média V2 source identitaire, absent du canonique (action explicite de récupération);
- média V2 ambigu/illégal (lecture/diagnostic, pas de restauration);
- URL `products.image_url` seule (aperçu seulement);
- source totalement dépourvue de média.

## Geste opérateur

Le bouton « Réintégrer les médias fournisseur » est proposé exclusivement pour `media_status=source_recoverable` sur un brouillon inactif. Confirmation explicite puis POST sans corps client vers `/api/admin/workspaces/catalog/products/:productRef/recover-source-media`.

La route exige rôle admin, autorité Catalogue globale ET autorité Sourcing globale. Le backend revérifie les identités, l’état et le snapshot fournisseur sous verrou PostgreSQL.

L'écrivain `catalog-promotion.restoreSourceMediaOnly` est le propriétaire métier : il réutilise l'upsert de média existant, avec validation de la structure V2, des identités, des rôles et des URL HTTPS. Il ne modifie ni prix, ni SKU, ni contenu, ni statut du produit, ni marché.

La transaction ne COMMIT que si tous les médias ont été retrouvés et qu’une ligne append-only a été écrite dans `catalog_media_recovery_audit` (migration **351**). Une faute de preuve ou d’audit annule aussi les médias. Aucun replay automatique d’un média désactivé.

## Tests et garde GO

- 113+ tests Jest ciblés (service, writer, permissions, UI), plus oracle physique PostgreSQL 16 pour nominal, appel répété, URL HTTP rejetée, rollback sur audit impossible.
- Avant staging : migration 351 promue sur environnement cible, exactes habilitations en place, vrai contrat V2 et candidat remis, schéma/table d'audit disponible.
- Après staging : recette Chromium 1440 avec un vrai produit et lecture de la trace PostgreSQL, validation du certificat séparée, puis décision humaine avant fusion.
- Les produits sans média source ou avec média ambigu restent à corriger par réapprovisionnement fournisseur ; on ne crée aucune image de substitution.

**Ce lot n'est pas un GO opérationnel tant que la migration et la recette staging réelle ne sont pas vérifiées.**
