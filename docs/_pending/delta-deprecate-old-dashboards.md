# Delta — Dépréciation anciens dashboards

## Type: deprecation
## Date: 2026-04-06
## PR: chore/deprecate-old-dashboards

### Changements

- 4 fichiers HTML monolithiques remplacés par des pages de redirection (~1KB chacune)
- `public/Komerce_Pilotage_v2.html` (109KB → 1KB) — redirect vers dashboard-app
- `public/Komerce_Pipeline.html` (32KB → 1KB) — redirect vers dashboard-app
- `public/Komerce_Hub.html` (42KB → 1KB) — redirect vers dashboard-app
- `public/Komerce_Relais.html` (99KB → 1KB) — redirect vers dashboard-app
- Total: -278KB de code HTML

### Impact Cartographie
- public/ : 4 fichiers modifiés (taille réduite), 0 ajouté, 0 supprimé
- Nombre total de fichiers : inchangé (~104)
- SHA à mettre à jour pour les 4 fichiers dans CARTOGRAPHY

### Roadmap
- Tâche 2.11 (Dépréciation anciens dashboards) : ⬜ → ✅
- Priorité 1 — Dashboard Pilotage Unifié : 11/11 TERMINÉ ✅
