# Komerce - Instructions GitHub Copilot

Avant toute modification :

1. Lire AGENTS.md.
2. Lire docs/CARTE_FIRST_INDEX.md.
3. Lire la carte feature ou le transversal concerne.
4. Annoncer un plan d'attaque court avant de coder.

Ne pas commencer par un audit, un rapport date, un prompt historique ou une sortie generee.

Plan d'attaque obligatoire :

- 8 a 12 lignes maximum dans le cas standard ;
- pas de paraphrase des docs lues ;
- nommer les fichiers lus ;
- nommer demande, feature/transversal, operation CRUD ;
- nommer perimetre, hors perimetre, invariants, risques ;
- nommer gates et tests prevus.

Un plan plus long est reserve aux changements multi-feature, DB, paiement, securite, migrations ou architecture transverse.

Gates utiles :

- npm run feature:registry
- npm run gate:schema
- npm run gate:touched-files
- npm run gate:docs-lint
- npm run gate:feature-audit
- npm run map:check

Si public/boutique est touche, lire aussi public/boutique/README.md et la carte parente.
