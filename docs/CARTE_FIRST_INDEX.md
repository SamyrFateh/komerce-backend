# Index vivant Komerce

Point d'entree documentaire apres AGENTS.md.

## Contexte permanent

La lecture de ce document **n'ouvre pas un nouveau contexte** : `AGENTS.md` reste actif pendant toute l'intervention.

Tout document consulté ensuite est subordonné à la gouvernance déjà chargée : feature owner, périmètre, invariants, headers `@komerce-arch`, `interventionIndex.mustCheck`, Debt Zero et preuve adaptée au risque.

En cas de contradiction, signaler la divergence ; ne jamais suivre silencieusement la règle locale.

## Parcours

1. Identifier la feature ou les fichiers probables.
2. Compiler le contexte : `npm run agent:context -- --feature <feature>` ou `--files <paths>`.
3. Qualifier l'operation CRUD à partir de la projection.
4. Ouvrir seulement les sources signalées nécessaires.
5. Annoncer le plan d'attaque.
6. Lancer les gates.
7. Ouvrir la PR après preflight vert.
8. Attendre les checks requis.
9. Si la PR est verte et mergeable, la merger sans intervention externe supplémentaire.
10. Vérifier le merge sur `main` et le déploiement attendu le cas échéant.

## Plan d'attaque obligatoire

Avant une modification substantielle, l'agent annonce comment il va traiter la demande avant de coder.

Le plan doit nommer :

- la demande comprise ;
- la feature ou le transversal ;
- l'operation CRUD ;
- la carte lue ;
- le perimetre probable ;
- le hors perimetre ;
- les invariants a proteger ;
- les risques ou points a verifier ;
- les gates et tests prevus.

## Gate avant PR

Chemin normal :

- `npm run pr:preflight`

`agent:context` réduit la lecture ; il ne remplace aucune preuve. Le preflight choisit et réutilise les gates canoniques selon le diff. Les commandes détaillées restent disponibles pour diagnostiquer un échec ; `npm run map:check` reste la reconstruction globale explicite.

## Clôture de PR

Une PR portée par l'agent n'attend pas une commande humaine « merge ». Dès que les checks requis sont verts et que la PR est mergeable, l'agent la merge lui-même puis vérifie le merge. Les exceptions et la distinction **merge autonome ≠ activation autonome** sont définies dans `AGENTS.md §4.1`.

## Regle

Intention dans les cartes. Verite derivee dans les generateurs. Historique dans les archives.
