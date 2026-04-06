# 🔄 Reprise de Session — Dashboard Komerce

## État au 06/04/2026 15:22

### ✅ Terminé
1. **README** — Renvois systématiques vers Roadmap + workflow nouvelle demande
2. **Gouvernance** — Règle commit auto 10 min dans AGENT_RULES + AGENTS_PROTOCOL
3. **Roadmap v14** — Dashboard Pilotage P1, Catalogue Pièces Auto/Moto P2
4. **Analyse d'impact** — Carte + Coffre OK pour Dashboard (feux verts)
5. **Specs** — DASHBOARD_REDESIGN.md commitée
6. **Instant App scaffoldée** — 4 vues (OPS, Finance, Pilotage, Alertes) avec données mock
7. **Connexion API Komerce** — Créée et active (conn_hfxyk870h3888ce18jww)
8. **Backend testé** — 7/8 endpoints OK, /ops en erreur 500

### 🔜 Prochaine étape : Brancher l'app sur les données live
- Créer `utils/api.ts` avec appels via `window.tasklet.runTool('conn_hfxyk870h3888ce18jww__remote_http_call', ...)`
- Réécrire `types.ts` pour matcher les réponses API réelles
- Adapter chaque composant aux vraies structures de données
- Le endpoint `/api/dashboard/ops` a un bug 500 → utiliser `/pipeline` + `/pilotage` pour compenser

### 📡 Endpoints backend disponibles
| Endpoint | Status | URL |
|----------|--------|-----|
| `/api/dashboard/finance` | ✅ | GET |
| `/api/dashboard/pilotage` | ✅ | GET |
| `/api/dashboard/pipeline` | ✅ | GET |
| `/api/dashboard/retards` | ✅ | GET |
| `/api/dashboard/clients` | ✅ | GET |
| `/api/dashboard/history` | ✅ | GET |
| `/api/dashboard/forecast?target_date=YYYY-MM-DD` | ✅ | GET |
| `/api/dashboard/ops` | ❌ 500 | Bug connu |

### 🔐 Infos connexion
- Backend: `https://komerce-backend-production.up.railway.app`
- Auth: admin@komerce.km / token JWT Bearer (expire dans 30j)
- Connection ID API: `conn_hfxyk870h3888ce18jww`
- Connection ID GitHub: `conn_7ynaw9wjqzwbyynze4xb`

### 📂 Fichiers app (Instant App Tasklet)
- `/agent/home/apps/komerce-dashboard/app.tsx` — App principale avec tabs
- `/agent/home/apps/komerce-dashboard/types.ts` — Types TypeScript (à adapter aux réponses API)
- `/agent/home/apps/komerce-dashboard/data/mockData.ts` — Données mock (à remplacer par API)
- `/agent/home/apps/komerce-dashboard/utils/formatters.ts` — Formatters KMF/EUR/%
- `/agent/home/apps/komerce-dashboard/components/` — OpsView, FinanceView, PilotageView, AlertsView, StatCard

### ⚡ Différences types mock vs API réelle
- **Finance** : `revenue` → `kpi`, `payments` → `paiements`, `margins` → `marges`, `monthly_trend` → via `/history`
- **Pilotage** : `kpi` → `volume` + `ca`, `top_products` → via `/clients`.`top_produits`, `pipeline_health` → calculer depuis `/pipeline`
- **OPS** : endpoint cassé → combiner `/pipeline` + `/pilotage`
- **Alertes** : pas d'endpoint dédié → combiner `/retards` + données finance (marges négatives)
