# Delta — Dashboard Pilotage : Branchement API réelle

> Date: 2026-04-06
> PR: #97
> Branche: feat/dashboard-api-connect

## ROADMAP Changes

### Section: Priorité 1 — Dashboard de Pilotage Unifié

Update task statuses:
- `| 2.7 | Vue Tendances (graphiques + projections) | ⬜ |` → `| 2.7 | Vue Tendances (graphiques + projections) | ✅ |`
- `| 2.8 | Vue Retards (liste + actions SMS) | ⬜ |` → `| 2.8 | Vue Retards (liste + actions SMS) | ✅ |`
- `| 2.9 | Branchement API réelle (remplacer mock data) | ⬜ |` → `| 2.9 | Branchement API réelle (remplacer mock data) | ✅ |`

### Section: Historique complété

Add to Session 06/04/2026:
- `| 10 | Vue Tendances validée + API connectée | PR #97 | ✅ |`
- `| 11 | Vue Retards validée + API connectée | PR #97 | ✅ |`
- `| 12 | Branchement API réelle (8 endpoints, auto-refresh 15s) | PR #97 | ✅ |`

## CARTOGRAPHY Changes

### dashboard-app/ — New files
- `utils/api.ts` (54 lines) — Service API typé
- `utils/useApi.ts` (72 lines) — Hook React loading/error/refresh
- `components/LoadingError.tsx` (59 lines) — Composant UI loading/erreur

### dashboard-app/ — Modified files
- `app.tsx` — Added Settings modal + API URL config
- `components/OverviewView.tsx` — 3 useApi hooks
- `components/PipelineView.tsx` — 1 useApi hook
- `components/FinanceView.tsx` — 1 useApi hook
- `components/ClientsView.tsx` — 1 useApi hook
- `components/CatalogueView.tsx` — 3 useApi hooks
- `components/RetardsView.tsx` — 1 useApi hook
- `components/TendancesView.tsx` — 2 useApi hooks

### dashboard-app/ — File count change
- Before: 10 files (app.tsx, 8 components, 1 data, 1 utils, types, config, index.html, styles.css)
- After: 13 files (+3: api.ts, useApi.ts, LoadingError.tsx)
