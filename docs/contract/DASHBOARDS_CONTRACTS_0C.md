# LOT 0C-ui — Contrats figés Pilotage & Finance

## Verdict

Le périmètre prioritaire demandé par la passation est désormais **inventorié et gelé sans invention** :

- vues : `SanteView`, `PilotageView`, `ControlTowerView`, `EconomicView`, `CostingView`, `PilotageFinView` ;
- **23 appels API consommés** par ces vues ;
- **23/23 enregistrés** dans `docs/contract/DASHBOARDS_CONTRACTS_0C.json` ;
- **9 appels PROVEN** par test ou lecture directe d'un service/handler ;
- **14 appels UNKNOWN explicites**, avec raison — aucune forme supposée ;
- un harnais reproductible calcule à tout moment `consommé ⊄ enregistré` et refuse les mismatches.

Ce lot ne change **aucun comportement runtime** et ne touche pas l'UI.

## Sources de vérité

1. **Consommation réelle** : `docs/DASHBOARDS_360.json`, généré par `scripts/gen-dashboards-360.js` depuis `Vue → KmcApi → endpoint`.
2. **Registre 0C-ui** : `docs/contract/DASHBOARDS_CONTRACTS_0C.json`.
3. **Harnais** : `tools/dashboard-contracts/verify-0c-ui.js`.
4. **Gate unitaire** : `tests/unit/dashboard-contracts-0c.test.js`.

## Commandes

```bash
# Couverture structurelle : 23/23 doivent être enregistrés.
node tools/dashboard-contracts/verify-0c-ui.js

# Sortie machine.
node tools/dashboard-contracts/verify-0c-ui.js --json

# Mode dette zéro : échoue tant qu'un UNKNOWN subsiste.
node tools/dashboard-contracts/verify-0c-ui.js --require-proven

# Test CI local.
npx jest tests/unit/dashboard-contracts-0c.test.js --runInBand
```

## Contrats déjà prouvés

| Endpoint | Preuve | Forme top-level gelée |
|---|---|---|
| `GET /api/dashboard/clients` | `services/dashboard-clients-queries.js#getClientsAnalysis` | `periode, kpi, segments, at_risk_clients, vip_clients, top_clients, top_produits, par_relais, evolution` |
| `GET /api/dashboard/finance` | `services/finance-metrics/finance-summary.js#getFinanceSummary` | `period, taux, kpi, paiements, marges, par_categorie, top_produits` |
| `GET /api/dashboard/ops` | `services/dashboard-ops-queries.js#getOps` | `activite, sla, logistique, delais, alertes` |
| `GET /api/dashboard/sales` | `services/finance-metrics/sales-analysis.js#getSalesAnalysis` | `period, kpi, marges, by_island, by_payment, top_products, by_category, evolution, funnel, cohorts` |
| `GET /api/admin/dashboard/unified` | `tests/unit/admin-dashboard.test.js` + route | `kpis_global, view_blocks, economic_flow, principles, system_alerts, data_quality` |
| `GET /api/admin/dashboard/control-tower` | `tests/unit/admin-dashboard.test.js` + route | `kpis, charts, tables, alerts, drilldown_links, data_quality` |
| `GET /api/admin/dashboard/costing` | `tests/unit/admin-dashboard.test.js` + route | `kpis, charts, tables, alerts, drilldown_links, data_quality` |

`getFinance` et `getOps` sont consommés par plusieurs vues : le compteur d'appels PROVEN est donc supérieur au nombre d'endpoints PROVEN uniques.

## Dette de preuve explicite

Les contrats suivants restent `UNKNOWN` dans ce gel ; ils sont **connus comme non prouvés**, donc un agent ne peut plus les compléter par supposition :

- cash : `/api/cash/reconciliation`, `/api/cash/uncollected` ;
- douane/config : `/api/admin/customs-shipments/rates/effective`, `/api/admin/finance-config` ;
- invendus : `getUnsoldStats` — URL réelle prouvée par `api-client-unsold.js` = `/api/unsold/stats/summary`, mais forme stricte encore non figée ;
- économie : `/api/admin/economic/charges`, `/coherence`, `/executive`, `/history`, `/variables` ;
- pricing : `/api/pricing/dashboard` ;
- costing détail : `/api/admin/costing/orders`, `/products`, `/relais`.

La dette est volontairement visible par `--require-proven` (exit non-zéro tant qu'il existe un `UNKNOWN`).

## Critère de sortie 0C-ui

Le critère de la passation est satisfait : chaque appel des surfaces KEEP/MERGE prioritaires Pilotage & Finance est soit **PROVEN**, soit **UNKNOWN explicite**, et le diff `consommé ⊄ enregistré` est calculable et testé.

**0C-ui = livré.** Le LOT 0 reste toutefois bloqué avant LOT 2 tant que **0C-eco** n'a pas son Golden CDR CURRENT réel capturé et vérifié.
