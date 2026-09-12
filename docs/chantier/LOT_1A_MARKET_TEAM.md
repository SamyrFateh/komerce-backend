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

## État implémenté — 2026-09-09

- Migration 196 : `market_team_invitations`, token brut jamais persisté, TTL 72 h par défaut.
- `team.read`, `team.grant`, `team.revoke`, `team.invite` passent LIVE ; autonomie courante 19/31 contre 15/31 au P0.
- L'email déjà utilisateur devient immédiatement une membership ; sinon une invitation PENDING est créée.
- L'acceptation exige une session authentifiée avec le même email et revalide le ceiling ainsi que les droits courants du grantor.
- Anti-lockout : la dernière membership portant `team.grant` ne peut pas être révoquée ou perdre cette capability.
- API capability-aware montée sous `/api/market-delegation` ; `users.role` ne constitue pas l'autorité d'équipe.
- `market_id` ou `marketId` fourni dans les bodies équipe est explicitement refusé.
- Tests unitaires de service, routes et invariants ajoutés.

## Dépendance

P0 (migrations 193–195) est mergé sur `main` et déployé avec succès sur Railway. LOT 1A est donc maintenant un lot incrémental direct au-dessus de la base live P0 ; sa migration propre est 196.
