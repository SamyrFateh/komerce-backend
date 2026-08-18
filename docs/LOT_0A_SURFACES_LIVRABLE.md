# LOT 0A — Matrice détaillée des 30 surfaces

Réf. doctrine : `DOCTRINE_ADMIN_DASHBOARDS.md` Partie III (verdicts) + II-1/II-2 (natures cibles).
Source factuelle : extracteur reproductible `tools/surfaces-inventory/inventory-0a.js` — scanne `public/dashboards/admin/js/**View.js`, recense les appels API (`KmcApi.*` + `fetch`/`apiFetch` bruts), les classe **lecture/écriture** par verbe, et croise avec les verdicts figés.

**Nature réelle** = déduite des écritures observées : `A — lecture seule` (dashboard), `B — workspace` (écrit), `MIXTE` (lit ET écrit → à scinder). **Nature doctrine** = cible.

## Matrice (généré + verdicts figés)

| Surface | Nature réelle | Doct. | L | É | Verbes d'écriture | Destination | Verdict |
|---|---|---|---|---|---|---|---|
| SanteView | A lecture seule | A | 8 | 0 | — | Pilotage (base) | **KEEP-base** |
| PilotageView | A lecture seule | A | 1 | 0 | — | Pilotage | MERGE |
| ControlTowerView | A lecture seule | A | 3 | 0 | — | Pilotage (top signals) | MERGE |
| ProblemsView | A lecture seule | A | 2 | 0 | — | Action Center | REBUILD ⚠️ recompute JS |
| ActionCenterView | **MIXTE** | A | 2 | 4 | acknowledge/snooze/resolve/generateSignals | Action Center (base) | KEEP-base |
| SalesView | A lecture seule | A | 1 | 0 | — | Commerce | REBUILD |
| ClientsView | A lecture seule | A/C | 3 | 0 | — | Commerce + Client 360 | SPLIT |
| OrdersLogisticsView | A lecture seule | A | 2 | 0 | — | Opérations | MERGE |
| EconomicView | A lecture seule | A | 4 | 0 | — | Finance / Économie | MERGE |
| CostingView | A lecture seule | A | 4 | 0 | — | Finance / Économie + Pricing WS | MERGE |
| PilotageFinView | A lecture seule | A | 3 | 0 | — | Finance | MERGE |
| AccountingView | A lecture seule ⚠️ | B | 4 | 0 | — | Finance/Compta WS | MERGE |
| InvoicesView | A lecture seule ⚠️ | B | 4 | 0 | — | Finance/Compta WS | MERGE |
| EconomicFlowView | A lecture seule ⚠️ | B | 2 | 0 | — | Pricing WS (carte éco) | MERGE |
| SimulatorView | A lecture seule ⚠️ | B | 5 | 0 | — | Pricing WS (simulation) | MERGE |
| HubRelaisView | **MIXTE** | B | 3 | 6 | hubMarkOrdered, hubShip, autoDistribute, relaisConfirmCash, relaisReceive, relaisCollect | Operations/Hub-Relais WS | KEEP |
| InventoryView | **MIXTE** | B | 3 | 2 | hubInventoryScanAssign, hubInventoryProposeAll | Operations/Hub-Relais WS | MERGE |
| TransitaireView | **MIXTE** | B | 3 | 1 | shipTransitaireParcel | Expéditions & Douane WS | MERGE |
| CustomsView | **MIXTE** ⚠️fetch | B | 4 | 3 | create/updateCustomsShipment, http:POST | Expéditions & Douane WS | KEEP |
| CategoriesView | B workspace ⚠️fetch | B | 0 | 6 | http:POST/PUT/DELETE | Catalogue WS | MERGE |
| ProductsView | B workspace ⚠️fetch | B | 0 | 3 | http:POST/PUT | Catalogue WS (+ Product 360) | MERGE |
| CatalogApprovalView | B workspace ⚠️fetch | B | 0 | 3 | http:POST (approve/reject) | Catalogue WS | MERGE |
| SourcingView | **MIXTE** | B | 2 | 1 | updateSourcingProduct | Sourcing WS | KEEP |
| SourcingScannerView | **MIXTE** | B | 4 | 6 | update/import/scan/reject/watchlist candidate | Sourcing WS | MERGE |
| SuppliersView | **MIXTE** | B | 2 | 3 | create/update/deletePartner | Sourcing WS | MERGE |
| PricingView | ? scanner gap ⚠️fetch | B | ? | ? | (fetch opts-based) | Pricing WS | KEEP |
| PricingWorkshopView | ? scanner gap ⚠️fetch | B | ? | ? | (fetch opts-based — édite cost_components) | Pricing WS | MERGE |
| PricingStrategyView | **MIXTE** | B | 3 | 3 | create/deletePricingCompetitor, applyPricingStrategy | Pricing WS | MERGE |
| SettingsView | **MIXTE** | — | 5 | 4 | patch/resetSettingRule, **putSettingsTaxes, putSettingsDims** | DISSOLVE | DISSOLVE |
| SharedCartsView | **MIXTE** | B | 2 | 3 | extend/expire/noteSharedCart | facette Client 360 / Commerce | MERGE |

## Findings

**① 11 surfaces MIXTES (lecture + écriture) → à scinder** en un dashboard (la partie lecture) et un workspace (les actions). Confirme la doctrine : une surface qui observe *et* exécute mélange deux natures (I-2). Les plus denses côté écriture : **HubRelaisView** (6 verbes — d'où le drapeau doctrine « inventorier avant fusion ») et **SourcingScannerView** (6).

**② 4 workspaces-cibles actuellement en LECTURE SEULE** — AccountingView, InvoicesView, EconomicFlowView, SimulatorView. Leur côté *exécution* n'existe pas encore dans l'UI : il est à **construire**, pas seulement à migrer (LOT 6/7/8). Généralise le constat déjà fait sur Finance (II-5b).

**③ 2 angles morts du scanner** — PricingView, PricingWorkshopView utilisent un wrapper `fetch(path, opts)` (méthode dans une variable, non résoluble statiquement). Passe manuelle : PricingWorkshopView **écrit** (édite `cost_components` via un drawer) → workspace ; PricingView à confirmer (probablement lecture + `apply`).

**④ 11 vues contournent `KmcApi`** (fetch/apiFetch bruts) alors que la doctrine du client dit « zéro fetch brut, toujours KmcApi ». Dérive d'accès API à normaliser pendant la refonte — et à couvrir par le gel de contrats 0C-ui.

## Recoupements avec 0B (cohérence prouvée)

- **SettingsView écrit `putSettingsTaxes` / `putSettingsDims`** → ce sont exactement les deux tables **fantômes** détectées en 0B (`pricing_category_taxes/dims`, lues par aucun moteur). Le frontend expose donc l'éditeur des tables mortes. La suppression 1A doit retirer **les deux bouts** : la route backend *et* ces appels frontend.
- **SanteView = 8 lectures, 0 écriture** → le dashboard le plus transverse et le plus « pur » (nature A parfaite) → confirme son rôle de **base Pilotage** et de premier remplissage du gabarit.

## Décisions résiduelles

1. **ProblemsView** : 0 écriture ici, mais recompute en JS (viole I-6) — verdict REBUILD confirmé ; reste à vérifier si sa détection diverge de `signals` (correction de vérité vs absorption).
2. **ActionCenterView MIXTE vs doctrine A** : ses écritures (ack/snooze/resolve/generate) sont les actions légitimes de l'Action Center. À trancher : dashboard + barre d'actions, ou dashboard + workspace-facette.
3. **PricingView / PricingWorkshopView** : finir la passe manuelle (opts-based).

## Reproductibilité

```bash
node tools/surfaces-inventory/inventory-0a.js            # matrice markdown
node tools/surfaces-inventory/inventory-0a.js --json     # sortie machine
```
