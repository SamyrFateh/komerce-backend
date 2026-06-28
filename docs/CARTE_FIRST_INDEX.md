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

Le plan est court par defaut : 8 a 12 lignes maximum. Il ne paraphrase pas les docs lues ; il nomme les fichiers lus et les decisions utiles.

Le plan doit nommer :

- la demande comprise ;
- la feature ou le transversal ;
- l'operation CRUD ;
- les fichiers de gouvernance lus ;
- le perimetre probable et le hors perimetre ;
- les invariants a proteger ;
- les risques ou points a verifier ;
- les gates et tests prevus.

Un plan plus long est reserve aux changements multi-feature, DB, paiement, securite, migrations ou architecture transverse.

## Gates

- npm run feature:registry
- npm run gate:schema
- npm run gate:touched-files
- npm run gate:docs-lint
- npm run gate:feature-audit
- npm run map:check

## Regle

Intention dans les cartes. Verite derivee dans les generateurs. Historique dans les archives.
