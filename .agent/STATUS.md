# STATUS — Chantier PDP

> Source de vérité : `origin/agent/lane-mobile-renderer`.
>
> Lire `.agent/START-HERE.md` avant toute interprétation. `main` est volontairement en
> retard jusqu’à la PR finale. Les lanes sont des classifications de sujet ; toutes les
> tâches restantes s’exécutent sur `agent/lane-mobile-renderer`.

## Action courante

1. Rapatrier `T-021` depuis la branche accidentelle `agent/lane-desktop-layout` vers
   `agent/lane-mobile-renderer` : code, artefacts, preuves, puis gates réexécutés.
2. Passer `T-021` à `REVIEW` dans un checkpoint documentaire séparé, référant les SHA de
   travail réellement présents sur la branche durable.
3. Démarrer ensuite `T-022` sur cette même branche, sans créer de nouvelle branche.

`T-017`, `T-018`, `T-019`, `T-020` et désormais `T-022` sont déjà en `REVIEW`; ne pas les
réimplémenter. `T-022` a été traitée directement sur `agent/lane-mobile-renderer` (dépendance
`T-001` uniquement) pendant que le rapatriement de `T-021` était géré séparément.
`T-023` reste bloquée uniquement sur ses deux captures EMPTY/FILLED.

| ID | Lane | Statut | Agent | Branche | Prochaine action |
|---|---|---|---|---|---|
| T-001 | LANE-0 | DONE | sonnet-chat-1 | agent/t-001-preflight-modal-mobile | — |
| T-002 | LANE-MOBILE-RENDERER | DONE | sonnet | agent/lane-mobile-renderer | — |
| T-003 | LANE-MOBILE-RENDERER | DONE | sonnet-chat | agent/lane-mobile-renderer | — |
| T-004 | LANE-MOBILE-RENDERER | DONE | sonnet-chat | agent/lane-mobile-renderer | — |
| T-005 | LANE-MOBILE-RENDERER | DONE | claude-sonnet-session-2 | agent/lane-mobile-renderer | — |
| T-006 | LANE-MOBILE-RENDERER | DONE | claude-sonnet-session-2 | agent/lane-mobile-renderer | — |
| T-007 | LANE-META | DONE | claude-sonnet-session-2 | agent/lane-mobile-renderer | — |
| T-008 | LANE-MOBILE-SHELL | DONE | claude-sonnet-session-2 | agent/lane-mobile-renderer | — |
| T-009 | LANE-MOBILE-SHELL | DONE | claude-sonnet-session-2 | agent/lane-mobile-renderer | — |
| T-010 | LANE-BUYBOX | DONE | claude-sonnet-session-2 | agent/lane-mobile-renderer | — |
| T-011 | LANE-MOBILE-SHELL | DONE | claude-sonnet-session-3 | agent/lane-mobile-renderer | — |
| T-012 | LANE-MOBILE-SHELL | DONE | claude-sonnet-session-3 | agent/lane-mobile-renderer | — |
| T-013 | LANE-DESKTOP-TYPE | DONE | claude-sonnet-session-3 | agent/lane-mobile-renderer | — |
| T-014 | LANE-DESKTOP-TYPE | DONE | claude-sonnet-session-3 | agent/lane-mobile-renderer | — |
| T-015 | LANE-DESKTOP-TYPE | DONE | claude-sonnet-session-3 | agent/lane-mobile-renderer | — |
| T-016 | LANE-DESKTOP-COMPOSITION | DONE | sonnet | agent/lane-mobile-renderer | — |
| T-017 | LANE-META | REVIEW | claude-sonnet-chat | agent/lane-mobile-renderer | Revue humaine des captures et preuves; aucune réimplémentation. |
| T-018 | LANE-DESKTOP-VISUAL | REVIEW | claude-sonnet-chat | agent/lane-mobile-renderer | Revue humaine du diff CSS, arbitrage, mesures et captures. |
| T-019 | LANE-DESKTOP-VISUAL | REVIEW | claude-chat-session | agent/lane-mobile-renderer | Revue humaine du diff, de desktop-zone.png et des gates. |
| T-020 | LANE-DESKTOP-LAYOUT | REVIEW | claude-chat-session | agent/lane-mobile-renderer | Revue humaine de la grille 3 pistes, de l’arbitrage ownership et des captures 1024/1440/1600. |
| T-021 | LANE-DESKTOP-LAYOUT | READY | — | agent/lane-mobile-renderer | Action courante : rapatrier le rail miniatures et ses preuves, réexécuter les gates, puis REVIEW. |
| T-022 | LANE-DESKTOP-LAYOUT | REVIEW | claude-chat-session | agent/lane-mobile-renderer | Revue humaine du diff CSS (aplat, dashed, titre 15/500, grille 4/5 cols, retrait ombre) et des captures 1024/1600. |
| T-023 | LANE-DESKTOP-COMPOSITION | BLOCKED | claude-chat-session | agent/lane-mobile-renderer | Générer desktop-actions-empty.png / desktop-actions-filled.png avec Chromium local, vérifier le layout, puis BLOCKED → REVIEW. |
| T-024 | LANE-FINISH | READY | — | agent/lane-mobile-renderer | Après T-022. |
| T-025 | LANE-FINISH | READY | — | agent/lane-mobile-renderer | Après T-024. |
| T-026 | LANE-TRANSVERSE | READY | — | agent/lane-mobile-renderer | Après T-025. |
| T-027 | LANE-TRANSVERSE | READY | — | agent/lane-mobile-renderer | Après T-026. |
| T-028 | LANE-FINISH | READY | — | agent/lane-mobile-renderer | Après clôture T-023, T-024, T-026 et T-027. |
| T-029 | LANE-FINISH | READY | — | agent/lane-mobile-renderer | Après clôture de ses dépendances visuelles et T-027. |
| T-030 | LANE-FINAL | READY | — | agent/lane-mobile-renderer | Après T-001 à T-029 toutes DONE. |
