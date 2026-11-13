# Brief commun : lot de corrections issu de la certification Chromium KM (#3868)

Propriétaire : SamyrFateh. Coordinateur : Opus. Exécutants : Sonnet, en mode ÉCO strict.

## Source
Les constats ont été prouvés en vrai Chromium sur le staging (issue #3868, commentaires de la phase 2 et de l'incident). Ne refais pas l'audit : va droit au code concerné. Captures de référence : `/tmp/claude-0/-home-claude/011d1491-2f57-5b4d-98e0-a4b4e0b2f674/scratchpad/parcours-km/shots/`.

## Règles
- **Une PR par défaut**, petite, avec un test qui prouve le correctif (unitaire, PostgreSQL ou Playwright selon le cas). Respecte `AGENTS.md` : §0, §1, §4, §7.1, §8 et §9.
- **NE MERGE PAS.** Mène chaque PR jusqu'à « Required verdict » vert, puis arrête-toi. Opus merge tout dans un seul créneau coordonné avec ChatGPT, qui teste sur le même staging. Chaque merge redéploie Railway.
- Aucune écriture sur le staging, aucune migration de données, aucun changement de doctrine économique.
- Si un correctif exige une décision métier non tranchée, arrête-toi sur ce défaut et rapporte-le. Passe ensuite au suivant.
- Mécanique du dépôt :
  - `gh pr` est bloqué (GraphQL) : passe par `gh api` REST.
  - Le corps de PR contient `## Pourquoi`, `## Quoi`, `## Tests`, `## Reprise`.
  - `npm run pr:preflight` avant chaque push (le hook l'exige).
  - Rebase si la branche est « behind ».
- Commits terminés par :
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01SwgRpiat6KjVtGnaB4GKZi
- Corps de PR terminé par :
  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  https://claude.ai/code/session_01SwgRpiat6KjVtGnaB4GKZi
- Ne lis, n'affiche et ne persiste aucun secret.

## Rendu
Rapport final court : numéro de PR par défaut, statut CI, défauts non traités avec leur raison.
