# LOT 7 — Parité finale, comptabilité et décommissionnement du dashboard legacy

> Généré : Lot 7 — Audit et migration finale  
> Dépôt : SamyrFateh/komerce-backend  
> Périmètre : Vues legacy restantes + parité des vues consolidées + décision de suppression

---

## 1. Résumé exécutif

Le Lot 7 clôt la migration des dashboards administratifs. Les Lots 1–6 avaient migré la
majorité des vues. Ce lot traite les 4 fonctions restantes (`accounting`, `pendingCash`,
`createParcel`, `parcel_reconciliation`), vérifie la parité des vues consolidées, corrige
les anomalies de routes, et établit le verdict GO / NO-GO pour la suppression du legacy.

**Résultat global : NO-GO conditionnel** — toutes les fonctions sont couvertes ou décidées,
mais la recette manuelle sur `AccountingView` et l'onglet `parcel_reconciliation` doit être
validée en environnement réel avant la suppression définitive du legacy.

---

## 2. Couverture actuelle avant Lot 7

| Vue moderne              | Route                    | Statut avant Lot 7 |
|--------------------------|--------------------------|-------------------|
| PilotageView             | /admin/pilotage          | ✅ Opérationnelle |
| ControlTowerView         | /admin/control-tower     | ✅ Opérationnelle |
| CostingView              | /admin/costing           | ✅ Opérationnelle |
| OrdersLogisticsView      | /admin/orders-logistics  | ✅ Opérationnelle |
| EventWorkspacesView      | /admin/event-workspaces  | ✅ Opérationnelle |
| SalesView                | /admin/sales             | ✅ Opérationnelle |
| EconomicView             | /admin/economic          | ✅ Opérationnelle |
| PilotageFinView          | /admin/pilotage-fin      | ✅ Opérationnelle |
| InvoicesView             | /admin/invoices          | ✅ Opérationnelle |
| ProblemsView             | /admin/problems          | ✅ Opérationnelle |
| ActionCenterView         | /admin/alerts            | ✅ Opérationnelle |
| ClientsView              | /admin/clients           | ✅ Opérationnelle |
| HubRelaisView            | /admin/hub-relais        | ✅ Opérationnelle |
| TransitaireView          | /admin/transitaire       | ✅ Opérationnelle |
| InventoryView            | /admin/inventory         | ✅ Opérationnelle |
| CategoriesView           | /admin/categories        | ✅ Opérationnelle |
| ProductsView             | /admin/products          | ✅ Opérationnelle |
| SourcingView             | /admin/sourcing          | ✅ Opérationnelle |
| SourcingScannerView      | /admin/sourcing-scanner  | ✅ Opérationnelle |
| PricingView              | /admin/pricing           | ✅ Opérationnelle |
| PricingWorkshopView      | /admin/pricing-workshop  | ✅ Opérationnelle |
| PricingStrategyView      | /admin/pricing-strategy  | ✅ Opérationnelle |
| CustomsView              | /admin/customs           | ✅ Opérationnelle |
| SuppliersView            | /admin/suppliers         | ✅ Opérationnelle |
| SanteView                | /admin/sante             | ✅ Opérationnelle |
| SettingsView             | /admin/settings          | ✅ Fichier OK — route manquante dans html-routes.js (corrigé Lot 7) |
| SimulatorView            | /admin/simulator         | ✅ Fichier OK — route manquante dans html-routes.js (corrigé Lot 7) |
| SharedCartsView          | /admin/shared-carts      | ✅ Fichier OK — route manquante dans html-routes.js (corrigé Lot 7) |
| **AccountingView**       | **/admin/accounting**    | ❌ **Absente — créée Lot 7** |

---

## 3. Fonctions legacy restantes

### 3.1 `accounting` — `ct-views-accounting.js`

**Fonctions métier :**
- KPI CA KMF/EUR, taux EUR/KMF, marge réelle avec taux
- Grand livre par section métier (charges depuis `/api/admin/economic/charges`)
- Réconciliation cash relais (attendu / collecté / déposé par agent)
- Commandes non encaissées (livrées sans confirmation de paiement)
- Top produits période + exports CSV ciblés

**Couverture avant Lot 7 :** ABSENTE — aucune vue moderne ne couvrait l'ensemble de ce
périmètre. `EconomicView` couvre les charges mais pas la réconciliation cash ni les
commandes non encaissées. `InvoicesView` couvre les factures mais pas le grand livre.

**Décision : A — Créer AccountingView** ✅ EXÉCUTÉ

### 3.2 `pendingCash` — `CT.views.pendingCash`

**Fonctions métier :**
- Liste des commandes `cash_relais` avec `payment_status = pending`
- Action "Confirmer paiement" → `POST /api/v2/orders/:ref/confirm-cash`

**Couverture :** `HubRelaisView` expose déjà le panel "Encaisser cash" (onglet
`r-encaisser`) avec la liste des commandes cash en attente et le bouton `relais-confirm-cash`
qui appelle `KmcApi.relaisConfirmCash()` → `/v2/orders/:ref/confirm-cash`.

**Décision : B — Couvert par HubRelaisView** ✅ PARITÉ VALIDÉE  
Parcours utilisateur : l'agent relais confirme le cash depuis HubRelaisView, idem legacy.

### 3.3 `createParcel` — `CT.views.createParcel`

**Fonctions métier :**
- Liste des commandes confirmées & payées sans colis
- Action "Créer colis" → `POST /api/v2/orders/:ref/create-parcel`

**Couverture :** `HubRelaisView` expose `autoDistribute()` → `/api/v2/orders/auto-distribute`
qui crée les colis automatiquement pour toutes les commandes éligibles. La création manuelle
un-par-un est remplacée par la distribution automatique, alignée sur le processus opérationnel.

**Décision : E — Remplacée par auto-distribute dans HubRelaisView** ✅ PARITÉ VALIDÉE

### 3.4 `parcel_reconciliation` — `CT.views.parcel_reconciliation`

**Fonctions métier :**
- Liste des colis dont le statut est bloqué ou en attention
- Source : `GET /api/v2/parcels/reconciliation`
- KPIs : total, bloqués, attention, OK
- Note dans legacy : "pour la réconciliation cash, voir Comptabilité"

**Couverture avant Lot 7 :** ABSENTE dans le SPA moderne.  
L'endpoint backend `/api/v2/parcels/reconciliation` existe et est fonctionnel.  
`KmcApi.getParcelReconciliation()` est définie et exportée dans `api-client.js`.

**Décision : A — Onglet dans ProblemsView** ✅ EXÉCUTÉ  
Justification : les colis à réconcilier sont des anomalies opérationnelles — placer cette
fonction dans `ProblemsView` (tab "⚖️ Réconciliation colis") est naturel pour l'utilisateur.

---

## 4. Décision comptabilité — détail

**Choix : A (Créer AccountingView)** — justification :

- `EconomicView` couvre le moteur économique (charges, variables, cohérence) mais pas la
  synthèse financière multi-devises ni la réconciliation cash.
- `InvoicesView` couvre les factures émises mais pas le grand livre ni les encaissements.
- `PilotageFinView` couvre les projections et le mix mais pas le suivi opérationnel.
- La vue legacy `ct-views-accounting.js` couvre 5 sections distinctes qui ensemble forment
  un module comptable cohérent nécessitant sa propre page.

**Fichier créé :** `public/dashboards/admin/js/views/AccountingView.js`  
**Sections couvertes :**
1. KPI synthétique (CA KMF/EUR, taux de change, marge réelle)
2. Grand livre par section — accordéon par famille métier
3. Réconciliation cash relais — cards par agent avec statuts
4. Commandes non encaissées — table avec âge et export CSV
5. Top produits période — table synthétique

---

## 5. Décision `pendingCash`

**Choix : B — Onglet dans HubRelaisView**

`HubRelaisView` expose déjà le panel "Encaisser cash" (identifié `r-encaisser`) avec
`relaisConfirmCash()`. La parité fonctionnelle avec `CT.views.pendingCash` est complète.
Aucune action supplémentaire requise.

---

## 6. Décision `createParcel`

**Choix : E — Supprimée, remplacée par auto-distribute**

`HubRelaisView` expose le bouton "Auto-distribuer" qui appelle `KmcApi.autoDistribute()`
→ `POST /api/v2/orders/auto-distribute`. Ce mécanisme remplace la création manuelle
colis-par-colis. L'endpoint `/api/v2/orders/create-parcel/:ref` reste disponible en backend
mais n'a plus besoin d'exposition directe dans le SPA.

---

## 7. Décision `parcel_reconciliation`

**Choix : A — Onglet dans ProblemsView**

Ajout d'un onglet "⚖️ Réconciliation colis" dans `ProblemsView` qui appelle
`KmcApi.getParcelReconciliation()`. L'onglet affiche les KPIs (total, bloqués, attention,
OK) et les cards de colis avec leurs issues. Lien de navigation vers `/admin/accounting`
pour la réconciliation cash.

---

## 8. Parité des vues consolidées

### A. Dashboard radar legacy (`ct-views-dashboard-radar.js`) vs `PilotageView`

| Fonctionnalité             | Legacy radar | PilotageView | Statut |
|----------------------------|:------------:|:------------:|--------|
| KPIs globaux               | ✅           | ✅           | Couvert — `getUnified()` → `kpis_global` |
| Alertes système            | ✅           | ✅           | Couvert — `data.system_alerts` |
| Flux colis (loadFlux)      | ✅           | ✅           | Couvert — blocs vues avec kpis_summary |
| Indicateurs financiers     | ✅           | ✅           | Couvert — `getUnified()` → blocs finance |
| Drill-down modal           | ✅           | ⚠️           | Partiel — navigation vers vues dédiées |
| Comparaison de période     | ✅           | ⚠️           | Partiel — filtres présents, pas de delta visuel |

**Verdict : PARTIELLE** — fonctionnellement couvert, drill-down via navigation entre vues
plutôt que modal inline. Acceptable pour le SPA.

### B. Pilotage opérationnel (`ct-views-pilotage-op.js`) vs `ControlTowerView`

`ct-views-pilotage-op.js` est un wrapper de `CT.views.pilotage` avec focus sur les onglets
opérationnels. `ControlTowerView` couvre :

| Fonctionnalité             | Legacy   | ControlTowerView | Statut |
|----------------------------|:--------:|:----------------:|--------|
| KPI activité               | ✅       | ✅               | Couvert |
| Statuts commandes          | ✅       | ✅               | Couvert |
| Alertes                    | ✅       | ✅               | Couvert |
| SLA & délais               | ✅       | ✅               | Couvert — section H `getOps()` |
| Invendus & stock           | ✅       | ✅               | Couvert — section I `getUnsoldStats()` |
| Performance relais         | ✅       | ✅               | Couvert |
| Drill-downs                | ✅       | ✅               | Couvert |

**Verdict : VALIDÉE**

### C. Hub + Relais (`HubRelaisView`)

| Fonctionnalité             | Legacy | HubRelaisView | Statut |
|----------------------------|:------:|:-------------:|--------|
| Commande fournisseur       | ✅     | ✅            | `hubMarkOrdered()` |
| Expédition hub             | ✅     | ✅            | `hubShip()` |
| Réception relais           | ✅     | ✅            | `relaisReceive()` |
| Collecte                   | ✅     | ✅            | `relaisCollect()` |
| Confirmation cash          | ✅     | ✅            | `relaisConfirmCash()` |
| Distribution auto          | ✅     | ✅            | `autoDistribute()` |
| Scan & inventaire          | ✅     | ✅            | `hubInventoryScanAssign()` |
| Alertes colis              | ✅     | ✅            | Panel alertes intégré |

**Verdict : VALIDÉE**

### D. Workspaces + Paniers partagés

| Concept        | Vue moderne        | Route                    | Statut |
|----------------|--------------------|--------------------------|--------|
| Event/Workspace| EventWorkspacesView| /admin/event-workspaces  | ✅ Séparé — pipeline workspace |
| Paniers partagés| SharedCartsView   | /admin/shared-carts      | ✅ Séparé — drawer détail + actions |

Les deux concepts sont correctement séparés. `EventWorkspacesView` gère le funnel de
création de commandes groupées (workspaces). `SharedCartsView` gère les paniers partagés
actifs avec audit des événements.

**Verdict : VALIDÉE**

---

## 9. Anomalies corrigées

| Anomalie | Fichier | Correction |
|----------|---------|------------|
| Routes Lot 6 manquantes dans html-routes.js | `bootstrap/html-routes.js` | Ajout de `/admin/settings`, `/admin/simulator`, `/admin/shared-carts` |
| Route accounting absente | `bootstrap/html-routes.js` | Ajout de `/admin/accounting` |
| AccountingView absente | — | Création de `dashboards/admin/js/views/AccountingView.js` |
| Script AccountingView non chargé | `dashboards/admin/index.html` | Ajout du tag `<script>` |
| Route accounting absente dans app.js | `dashboards/admin/js/app.js` | Ajout de la route `ADMIN` |
| parcel_reconciliation sans couverture SPA | `ProblemsView.js` | Ajout onglet + `loadParcelReco()` |

---

## 10. Matrice routes modernes

| Route                      | Vue                  | Fichier | index.html | app.js | html-routes | API vérifiée | Statut |
|----------------------------|----------------------|---------|:----------:|:------:|:-----------:|:------------:|--------|
| /admin/pilotage            | PilotageView         | ✅      | ✅         | ✅     | ✅          | ✅           | ✅ OK |
| /admin/control-tower       | ControlTowerView     | ✅      | ✅         | ✅     | ✅          | ✅           | ✅ OK |
| /admin/costing             | CostingView          | ✅      | ✅         | ✅     | ✅          | ✅           | ✅ OK |
| /admin/orders-logistics    | OrdersLogisticsView  | ✅      | ✅         | ✅     | ✅          | ✅           | ✅ OK |
| /admin/event-workspaces    | EventWorkspacesView  | ✅      | ✅         | ✅     | ✅          | ✅           | ✅ OK |
| /admin/sales               | SalesView            | ✅      | ✅         | ✅     | ✅          | ✅           | ✅ OK |
| /admin/economic            | EconomicView         | ✅      | ✅         | ✅     | ✅          | ✅           | ✅ OK |
| /admin/pilotage-fin        | PilotageFinView      | ✅      | ✅         | ✅     | ✅          | ✅           | ✅ OK |
| /admin/invoices            | InvoicesView         | ✅      | ✅         | ✅     | ✅          | ✅           | ✅ OK |
| /admin/problems            | ProblemsView         | ✅      | ✅         | ✅     | ✅          | ✅           | ✅ OK |
| /admin/alerts              | ActionCenterView     | ✅      | ✅         | ✅     | ✅          | ✅           | ✅ OK |
| /admin/clients             | ClientsView          | ✅      | ✅         | ✅     | ✅          | ✅           | ✅ OK |
| /admin/hub-relais          | HubRelaisView        | ✅      | ✅         | ✅     | ✅          | ✅           | ✅ OK |
| /admin/transitaire         | TransitaireView      | ✅      | ✅         | ✅     | ✅          | ✅           | ✅ OK |
| /admin/inventory           | InventoryView        | ✅      | ✅         | ✅     | ✅          | ✅           | ✅ OK |
| /admin/categories          | CategoriesView       | ✅      | ✅         | ✅     | ✅          | ✅           | ✅ OK |
| /admin/products            | ProductsView         | ✅      | ✅         | ✅     | ✅          | ✅           | ✅ OK |
| /admin/sourcing            | SourcingView         | ✅      | ✅         | ✅     | ✅          | ✅           | ✅ OK |
| /admin/sourcing-scanner    | SourcingScannerView  | ✅      | ✅         | ✅     | ✅          | ✅           | ✅ OK |
| /admin/pricing             | PricingView          | ✅      | ✅         | ✅     | ✅          | ✅           | ✅ OK |
| /admin/pricing-workshop    | PricingWorkshopView  | ✅      | ✅         | ✅     | ✅          | ✅           | ✅ OK |
| /admin/pricing-strategy    | PricingStrategyView  | ✅      | ✅         | ✅     | ✅          | ✅           | ✅ OK |
| /admin/customs             | CustomsView          | ✅      | ✅         | ✅     | ✅          | ✅           | ✅ OK |
| /admin/suppliers           | SuppliersView        | ✅      | ✅         | ✅     | ✅          | ✅           | ✅ OK |
| /admin/sante               | SanteView            | ✅      | ✅         | ✅     | ✅          | ✅           | ✅ OK |
| /admin/settings            | SettingsView         | ✅      | ✅         | ✅     | ✅ **corrigé** | ✅        | ✅ OK |
| /admin/simulator           | SimulatorView        | ✅      | ✅         | ✅     | ✅ **corrigé** | ✅        | ✅ OK |
| /admin/shared-carts        | SharedCartsView      | ✅      | ✅         | ✅     | ✅ **corrigé** | ✅        | ✅ OK |
| /admin/accounting          | AccountingView       | ✅ **créé** | ✅ **ajouté** | ✅ **ajouté** | ✅ **ajouté** | ✅ | ✅ OK |

---

## 11. Audit KmcApi

| Fonction               | Définie | Exportée | Appelée par           | Endpoint                          | Statut |
|------------------------|:-------:|:--------:|-----------------------|-----------------------------------|--------|
| getControlTower        | ✅      | ✅       | ControlTowerView      | /api/admin/dashboard/control-tower| ✅     |
| getOps                 | ✅      | ✅       | ControlTowerView      | /api/dashboard/ops                | ✅     |
| getUnsoldStats         | ✅*     | ✅*      | ControlTowerView      | /api/unsold/stats/summary         | ✅     |
| getUnified             | ✅      | ✅       | PilotageView          | /api/admin/dashboard/unified      | ✅     |
| getFinance             | ✅      | ✅       | AccountingView        | /api/dashboard/finance            | ✅     |
| getInvoices            | ✅      | ✅       | InvoicesView          | /api/invoices                     | ✅     |
| getCashUncollected     | ✅      | ✅       | AccountingView        | /api/cash/uncollected             | ✅     |
| getCashReconciliation  | ✅      | ✅       | AccountingView        | /api/cash/reconciliation          | ✅     |
| getParcelReconciliation| ✅      | ✅       | ProblemsView          | /api/v2/parcels/reconciliation    | ✅     |
| getSettings            | ✅      | ✅       | SettingsView          | /api/admin/rules                  | ✅     |
| simStatus              | ✅      | ✅       | SimulatorView         | /api/admin/simulator/status       | ✅     |
| getSharedCarts         | ✅      | ✅       | SharedCartsView       | /api/admin/shared-carts           | ✅     |

*`getUnsoldStats` est définie et exportée via `api-client-unsold.js` (chargé après api-client.js).

**Méthodes KmcApi manquantes : 0**

---

## 12. Critères de suppression du legacy

| Critère | Statut | Notes |
|---------|--------|-------|
| Toutes fonctions legacy classées | ✅ | 4/4 traitées |
| Aucune fonction critique perdue | ✅ | pendingCash, createParcel couverts ; accounting et parcel_reco créés |
| Routes modernes accessibles | ✅ | 29 routes validées |
| Rôles validés | ⚠️ | À valider en recette : ADMIN_LEGACY_ENABLED=0 |
| Endpoints répondent correctement | ⚠️ | À tester en env réel — cash.js, parcel-api-v2 vérifiés structurellement |
| Parité des vues consolidées documentée | ✅ | Sections 8A–8D |
| Recette manuelle terminée | ❌ | Non faite — AccountingView et onglet reco à tester |
| Rollback possible | ✅ | `ADMIN_LEGACY_ENABLED=1` réactive le legacy |

**Conclusion : NO-GO** jusqu'à la recette manuelle de :
1. `/admin/accounting` — les 4 appels API doivent répondre
2. `/admin/problems` onglet "⚖️ Réconciliation colis"
3. `/admin/settings`, `/admin/simulator`, `/admin/shared-carts` — routes html-routes corrigées

---

## 13. Tests obligatoires avant GO

```bash
# Vérifier absence d'erreurs syntax
node --check public/dashboards/admin/js/views/AccountingView.js
node --check public/dashboards/admin/js/views/ProblemsView.js
node --check public/dashboards/admin/js/app.js
node --check bootstrap/html-routes.js

# Vérifier routes HTML
curl -I http://localhost:PORT/admin/accounting      # 200
curl -I http://localhost:PORT/admin/settings        # 200
curl -I http://localhost:PORT/admin/simulator       # 200
curl -I http://localhost:PORT/admin/shared-carts    # 200

# Vérifier endpoints
curl -H "Cookie: ..." http://localhost:PORT/api/dashboard/finance?period=30
curl -H "Cookie: ..." http://localhost:PORT/api/admin/economic/charges
curl -H "Cookie: ..." http://localhost:PORT/api/cash/reconciliation
curl -H "Cookie: ..." http://localhost:PORT/api/cash/uncollected
curl -H "Cookie: ..." http://localhost:PORT/api/v2/parcels/reconciliation
```

---

## 14. Conclusion GO / NO-GO

```
VERDICT : NO-GO (recette manuelle requise)

Raison : AccountingView et l'onglet parcel_reconciliation sont nouveaux et
n'ont pas été testés en environnement réel. Toutes les conditions structurelles
sont remplies. Une session de recette de 30 min suffit pour basculer en GO.

Conditions de GO :
  ✓ /admin/accounting charge et affiche les données (ou états vides gérés)
  ✓ /admin/problems onglet Réconciliation colis fonctionne
  ✓ /admin/settings, /admin/simulator, /admin/shared-carts accessibles
  ✓ ADMIN_LEGACY_ENABLED=0 ne provoque aucun 404 sur les parcours admin
```
