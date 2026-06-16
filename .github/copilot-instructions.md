# Komerce — Instructions GitHub Copilot

## Instruction obligatoire — lire avant toute action

Avant de modifier, corriger, supprimer ou implémenter quoi que ce soit dans ce projet, tu dois lire la gouvernance active.

## Lecture obligatoire dans cet ordre

1. `AGENTS.md`
2. `docs/README.md`
3. `docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md`
4. `docs/KOMERCE_ARCH_CARTOGRAPHY_STATUS.md`
5. `docs/KOMERCE_ARCH_HEADER_GRAPH.md`
6. `docs/komerce-arch-header-graph.json`
7. `docs/chantier/STATUS.md`
8. Les documents actifs de la zone touchée listés dans `docs/README.md`

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

## Workflow

```txt
AVANT de coder :
1. Lire AGENTS.md
2. Lire docs/README.md
3. Lire docs/KOMERCE_ARCH_GRAPH_DOCTRINE.md
4. Lire le graphe et interventionIndex des fichiers touchés
5. Lire les docs actives de la zone
6. Seulement alors implémenter

APRÈS avoir codé :
1. Mettre à jour les headers impactés
2. Régénérer le graphe si nécessaire
3. Mettre à jour la doc active concernée
4. Mettre à jour STATUS.md si l'état courant change
5. Lancer les garde-fous/tests applicables
```

## Boutique

Si tu touches `public/boutique/**`, lire aussi :

- `docs/boutique/README.md`
- `public/boutique/README.md`

La Boutique n'est pas exemptée de la doctrine graphe.

## Règles absolues

- Jamais de nouveau fichier source sans header ou owner.
- Jamais de changement DB sans mise à jour des champs DB du header.
- Jamais de suppression/fusion sans nettoyage des liens de graphe.
- Jamais d'invention de précision : garder `@unknown` ou `resolve_before_behavior_change` si nécessaire.
- Toujours vérifier les claims contre le code réel.