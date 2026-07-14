# alerts-compat.js — archivé

`utils/alerts-compat.js` (couche de compatibilité issue de PR563, réécrivant
les INSERT legacy `alerts(level, source, message, payload)` vers le schéma
physique réel) a été archivé le 2026-07-14 dans le cadre de la mission
ALERTS_CONTRACT_RECOVERY.

Raison : plus aucun consommateur runtime après migration des 16 writers vers
`utils/alerts.js` (`createAlert()`). Seuls des tests unitaires testant la
couche de compat elle-même (`alerts-compat.test.js`, `verify-rewrite.test.js`)
la référençaient encore — aucun service/route ne l'importait plus.

Voir `docs/ALERTS_CONTRACT_RECOVERY_AUDIT.md` pour l'inventaire complet et
la chronologie PR563 → V2.10 → cette mission.
