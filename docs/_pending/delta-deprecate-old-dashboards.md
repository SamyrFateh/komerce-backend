# Delta — Dépréciation anciens dashboards

## Type: deprecation + roadmap-update
## Date: 2026-04-06
## PR: #98

### Changements code

- 4 fichiers HTML monolithiques remplacés par des pages de redirection (~1KB chacune)
- `public/Komerce_Pilotage_v2.html` (109KB → 1KB) — redirect vers dashboard-app
- `public/Komerce_Pipeline.html` (32KB → 1KB) — redirect vers dashboard-app
- `public/Komerce_Hub.html` (42KB → 1KB) — redirect vers dashboard-app
- `public/Komerce_Relais.html` (99KB → 1KB) — redirect vers dashboard-app
- Total: -278KB de code HTML

### Roadmap

- Tâche 2.10 (Tests & validation) : ⬜ → ✅
- Tâche 2.11 (Dépréciation anciens dashboards) : ⬜ → ✅
- **Priorité 1 — Dashboard Pilotage Unifié : 11/11 ✅ TERMINÉ**
- Progression globale : "Dashboard Pilotage Unifié" → ✅ 11/11

### Impact Cartographie
- public/ : 4 fichiers modifiés (taille réduite), 0 ajouté, 0 supprimé
- SHA à mettre à jour pour les 4 fichiers remplacés

### Historique
| # | Action | PR | Statut |
|---|--------|-----|--------|
| 14 | Tests & validation dashboard (46 checks passés) | PR #97 | ✅ |
| 15 | Dépréciation 4 anciens dashboards (redirects) | PR #98 | ✅ |
| 16 | **PRIORITÉ 1 TERMINÉE** — Dashboard Pilotage Unifié 11/11 | — | 🎉 |
