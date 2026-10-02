# Index vivant Komerce

Point d'entree documentaire apres AGENTS.md.

## Contexte permanent

La lecture de ce document **n'ouvre pas un nouveau contexte** : `AGENTS.md` reste actif pendant toute l'intervention.

Tout document consulté ensuite est subordonné à la gouvernance déjà chargée : feature owner, périmètre, invariants, headers `@komerce-arch`, `interventionIndex.mustCheck`, Debt Zero et preuve adaptée au risque.

En cas de contradiction, signaler la divergence ; ne jamais suivre silencieusement la règle locale.

## Parcours

1. Identifier la feature ou le transversal.
2. Lire la carte dans features/.
3. Qualifier l'operation CRUD.
4. Verifier le perimetre et les invariants.
5. Annoncer le plan d'attaque.
6. Lancer les gates.

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

Le preflight choisit et réutilise les gates canoniques selon le diff. Les commandes détaillées restent disponibles pour diagnostiquer un échec ; `npm run map:check` reste la reconstruction globale explicite.

## Regle

Intention dans les cartes. Verite derivee dans les generateurs. Historique dans les archives.
