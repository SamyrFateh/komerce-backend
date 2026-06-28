# Index vivant Komerce

Point d'entree documentaire apres AGENTS.md.

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

## Gates

- npm run feature:registry
- npm run gate:schema
- npm run gate:touched-files
- npm run gate:docs-lint
- npm run gate:feature-audit
- npm run map:check

## Regle

Intention dans les cartes. Verite derivee dans les generateurs. Historique dans les archives.
