# A5 — Clarification des dossiers de migrations

> Date : 2026-05-17
> Lot : A5
> Scope : documentation uniquement

## Constat

Le runner de migration actif est `scripts/migrate.js`.

Ce runner ne parcourt pas automatiquement les fichiers `.sql` des dossiers `migrations/` ou `db/migrations/`.

Il exécute :

1. `fixAdminHash()` depuis `scripts/fix-schema.js`
2. `fixMissingSchema()` depuis `scripts/fix-schema.js`
3. `runAllSeeds()` depuis `scripts/seed.js`

## Conséquence

Les dossiers de fichiers SQL sont à considérer comme historique / documentation de schéma tant qu'aucun runner ne les lit explicitement.

Les collisions de noms de fichiers dans `migrations/` ne bloquent donc pas le boot actuel, mais restent une dette de propreté pour les exécutions manuelles ou futures.

## Règle opérationnelle

Avant d'ajouter une nouvelle migration :

- vérifier si elle doit être intégrée au runner JS existant ;
- ne pas modifier une migration déjà mergée ;
- éviter les collisions de préfixes numériques ;
- documenter toute migration manuelle dans une PR dédiée.

## Recommandation

A5 peut être considéré comme clarifié côté diagnostic.

Une passe ultérieure peut décider soit :

- d'archiver `db/migrations/` si confirmé mort ;
- soit de créer un vrai runner SQL unique ;
- soit de garder les SQL comme références historiques mais hors chemin de démarrage.
