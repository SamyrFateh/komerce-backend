# Komerce — Instructions GitHub Copilot

## Instruction obligatoire — lire avant toute action

Avant de modifier, corriger, supprimer ou implémenter quoi que ce soit dans ce projet, tu dois lire la gouvernance active.

## Lecture obligatoire dans cet ordre

1. `AGENTS.md`
2. `docs/README.md`
3. `docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md`
4. `docs/KOMERCE_DB_SCHEMA_DOCTRINE.md`
5. `docs/KOMERCE_ARCH_CARTOGRAPHY_STATUS.md`
6. `docs/KOMERCE_ARCH_HEADER_GRAPH.md`
7. `docs/komerce-arch-header-graph.json`
8. `docs/SCHEMA.md`
9. `docs/chantier/STATUS.md`
10. Les documents actifs de la zone touchée listés dans `docs/README.md`

## Doctrine graphe obligatoire

La cartographie `@komerce-arch` est le contrat d'intervention du dépôt.

Toute création, modification ou suppression de feature fonctionnelle doit maintenir :

- les headers `@komerce-arch` / `@komerce-arch-lite` ;
- les champs `@inputs`, `@outputs`, `@depends`, `@used-by` ;
- les champs `@db-read`, `@db-write`, `@db-txn` si la DB est touchée ;
- les champs `@doctrine`, `@impact-areas` si le flux métier change ;
- le graphe généré via `node scripts/generate-komerce-arch-graph.js`.

Vérifier après changement :

- `files without headers: 0`
- `lite headers without owner: 0`
- pas de lien mort après suppression/fusion

Un changement fonctionnel sans cartographie à jour est incomplet.

## Doctrine DB obligatoire

Toute migration ou modification de table, colonne, enum, index, trigger, fonction ou contrainte doit maintenir :

- `docs/KOMERCE_DB_SCHEMA_DOCTRINE.md`
- `docs/SCHEMA.md`
- les headers DB des fichiers lecteurs/écrivains
- le graphe si les headers changent

Un changement DB sans schéma canonique et headers alignés est incomplet.

## Workflow

```txt
AVANT de coder :
1. Lire AGENTS.md
2. Lire docs/README.md
3. Lire docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md
4. Lire docs/KOMERCE_DB_SCHEMA_DOCTRINE.md si la DB est touchée
5. Lire le graphe et interventionIndex des fichiers touchés
6. Lire docs/SCHEMA.md si une table ou migration est concernée
7. Lire les docs actives de la zone
8. Seulement alors implémenter

APRÈS avoir codé :
1. Mettre à jour les headers impactés
2. Mettre à jour SCHEMA.md si le schéma DB change
3. Régénérer le graphe si nécessaire
4. Mettre à jour la doc active concernée
5. Mettre à jour STATUS.md si l'état courant change
6. Lancer les garde-fous/tests applicables
```

## Boutique

Si tu touches `public/boutique/**`, lire aussi :

- `docs/boutique/README.md`
- `public/boutique/README.md`

La Boutique n'est pas exemptée de la doctrine graphe.

## Règles absolues

- Jamais de nouveau fichier source sans header ou owner.
- Jamais de changement DB sans mise à jour de `docs/SCHEMA.md` et des champs DB du header.
- Jamais de suppression/fusion sans nettoyage des liens de graphe.
- Jamais d'invention de précision : garder `@unknown` ou `resolve_before_behavior_change` si nécessaire.
- Toujours vérifier les claims contre le code réel.