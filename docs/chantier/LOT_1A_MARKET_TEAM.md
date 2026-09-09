# LOT 1A — Équipe Market Operator

Objectif : rendre la gestion d'équipe réellement capability-aware sans réutiliser `viewer/manager` comme autorité métier.

## Contrat

- Résolution du Market ID côté serveur depuis un code marché canonique.
- Lecture équipe : `team.read`.
- Ajout / grant de capabilities : `team.grant`.
- Révocation membership / capabilities : `team.revoke`.
- Invitation d'un utilisateur absent : `team.invite` avec invitation persistée, expirante et auditable.
- Un membre ne peut jamais déléguer plus qu'il ne possède lui-même, et jamais au-dessus du ceiling de l'assignment.
- Les capacités GROUP/CENTRAL_ONLY restent inaccessibles.
- Les anciennes routes admin restent compatibles pendant le cutover ; `require-market-scope.js` reste inchangé.

## Dépendance

Ce lot dépend du P0 (migrations 193–195) et sera livré sur une branche/PR distincte.
