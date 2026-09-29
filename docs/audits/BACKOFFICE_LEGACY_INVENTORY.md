# Inventaire Back Office Legacy → Canonical

Date de référence : 2026-09-29  
Objet : figer le périmètre fonctionnel réel du Back Office historique avant toute nouvelle refonte de navigation.

## 1. Principe

Le Legacy séparait deux usages :

- **Tour de Contrôle (CT)** : signal, synthèse, arbitrage, décision.
- **Back Office (BO)** : traitement, mise à jour, exécution.

Le Canonical a correctement consolidé beaucoup de vérités métier, mais la navigation actuelle ne rend plus visible toute l'étendue fonctionnelle du système.

Cet inventaire distingue donc trois choses :

1. la **capacité métier historique** ;
2. son **état runtime actuel** ;
3. sa **destination Canonical** et son niveau de couverture.

Statuts de couverture :

- **COVERED** : capacité réexprimée et accessible dans Canonical ;
- **COVERED_BUT_HIDDEN** : capacité réexprimée mais insuffisamment visible ;
- **PARTIAL** : absorption engagée mais couverture/preuve incomplète ;
- **LEGACY_REQUIRED** : la surface Legacy reste nécessaire ;
- **ORPHANED** : code encore présent mais route HTML non montée.

## 2. Registre Legacy principal

Le registre `public/dashboards/admin/js/app.js` contient **26 routes métier** réparties entre CT et BO.

### 2.1 Tour de Contrôle — PILOTAGE

| Route Legacy | Vue | Fonction réelle | État runtime actuel | Destination Canonical | Couverture | Cible navigation future |
|---|---|---|---|---|---|---|
| `/admin/pilotage` | PilotageView | Carte globale du système, 4 vues spécialisées, boucle économique | Canonical direct, rollback `?legacy=1` | Pilotage | **COVERED** | Dashboards → Pilotage |
| `/admin/sante` | SanteView | Santé business transverse : cash, marge, pipeline, clients + corrélations | Legacy live | Pilotage + Commerce + Finance + Opérations | **LEGACY_REQUIRED** | Pilotage → Activité / Santé |
| `/admin/control-tower` | ControlTowerView | « Faut-il agir aujourd'hui ? » : alertes, commandes, colis, SLA, relais, invendus | redirect Canonical vers Pilotage ; rollback Legacy | Pilotage + Opérations + Action Center | **COVERED_BUT_HIDDEN** | Pilotage → Tour de contrôle / Action Center |
| `/admin/costing` | CostingView | Coût réel par commande, produit, relais ; variance et marge réelle | redirect Canonical vers Finance ; rollback Legacy | Finance + Atelier économique | **PARTIAL** | Finance → Coûts |
| `/admin/orders-logistics` | OrdersLogisticsView | Pipeline commandes/colis, exceptions, productivité | redirect Canonical vers Opérations ; rollback Legacy | Opérations | **COVERED_BUT_HIDDEN** | Opérations → Logistique / Retards |
| `/admin/sales` | SalesView | CA, volume, panier moyen, marge, funnel, catégories, top produits, îles, paiements, cohortes | Legacy live | Commerce | **LEGACY_REQUIRED** | Commerce → Ventes |
| `/admin/economic` | EconomicView | Santé économique catalogue + mois, cohérence, marges, charges | redirect Canonical vers Pricing Workspace ; rollback Legacy | Atelier économique | **PARTIAL** | Finance → Économie |
| `/admin/pilotage-fin` | PilotageFinView | Trajectoire CA, mix catégories, projections, variables économiques | redirect Canonical vers Finance ; rollback Legacy | Finance | **PARTIAL** | Finance → Prévisions |
| `/admin/invoices` | InvoicesView | Factures, rapprochement cash, impayés livrés, charges | redirect Canonical vers Comptabilité ; rollback Legacy | Comptabilité | **COVERED_BUT_HIDDEN** | Finance → Factures |

### 2.2 Tour de Contrôle — SOURCING / PRICING

| Route Legacy | Vue | Fonction réelle | État runtime actuel | Destination Canonical | Couverture | Cible navigation future |
|---|---|---|---|---|---|---|
| `/admin/providers` | ProvidersView | Control Center fournisseurs catalogue : capabilities discovery/sync/import/production, certification runtime, autopilot | **route non montée dans `html-routes.js`** | Cockpit imports + Sourcing Workspace | **ORPHANED** | Catalogue → Sources / Fournisseurs catalogue |
| `/admin/pricing` | PricingView | Construction du prix produit, composition coûts, recommandation | redirect Canonical vers Pricing Workspace ; rollback Legacy | Atelier économique | **COVERED** | Finance → Atelier économique |
| `/admin/pricing-workshop` | PricingWorkshopView | Configuration des coûts fixes/variables, scopes, allocations | redirect Canonical vers Pricing Workspace ; rollback Legacy | Atelier économique | **COVERED** | Finance → Coûts / Configuration |
| `/admin/pricing-strategy` | PricingStrategyView | Stratégie de prix, concurrence, simulation, application | redirect Canonical vers Pricing Workspace ; rollback Legacy | Atelier économique | **COVERED** | Finance → Stratégie prix |
| `/admin/economic-flow` | EconomicFlowView | Carte économique produit, passage coût → contribution → prix → décision | redirect Canonical vers Pricing Workspace ; rollback Legacy | Atelier économique | **COVERED** | Finance → Carte économique |

### 2.3 Back Office — OPÉRATIONS

| Route Legacy | Vue | Fonction réelle | État runtime actuel | Destination Canonical | Couverture | Cible navigation future |
|---|---|---|---|---|---|---|
| `/admin/problems` | ProblemsView | Détection d'anomalies commandes/paiements/stock et actions rapides | redirect vers Action Center ; rollback Legacy | Action Center | **COVERED** | Pilotage → Action Center |
| `/admin/alerts` | ActionCenterView | Signaux actifs, incidents, acknowledge / snooze / resolve | redirect vers Action Center ; rollback Legacy | Action Center | **COVERED** | Pilotage → Action Center |
| `/admin/clients` | ClientsView | Segments, VIP, at-risk, dormants, recherche, détail client | Canonical direct, rollback Legacy | Client Index + Client 360 | **COVERED_BUT_HIDDEN** | Commerce → Clients |
| `/admin/hub-relais` | HubRelaisView | Commander, répartir, expédier, encaisser, réceptionner, distribuer | redirect vers Workspace Opérations ; rollback Legacy | Hub / Relais | **COVERED_BUT_HIDDEN** | Opérations → Hub / Relais |
| `/admin/transitaire` | TransitaireView | Colis à expédier, transit, retards, expédition unitaire/bulk, historique | Legacy live | Expéditions & Douane Workspace (partiel) | **LEGACY_REQUIRED** | Opérations → Transit / Expéditions |
| `/admin/inventory` | InventoryView | Stock hub, propositions d'affectation, scan assign, buffer, recalcul | redirect vers Workspace Opérations ; rollback Legacy | Hub / Relais | **COVERED_BUT_HIDDEN** | Opérations → Inventaire |

### 2.4 Back Office — FINANCE / PARTENAIRES

| Route Legacy | Vue | Fonction réelle | État runtime actuel | Destination Canonical | Couverture | Cible navigation future |
|---|---|---|---|---|---|---|
| `/admin/accounting` | AccountingView | Réconciliation cash, impayés, charges, financement, grand livre | redirect vers Comptabilité ; rollback Legacy | Comptabilité | **COVERED** | Finance → Comptabilité |
| `/admin/customs` | CustomsView | Shipments douane, CIF, droits payés, ventilation, taux terrain, activation | Legacy live | Expéditions & Douane Workspace | **LEGACY_REQUIRED** | Opérations → Douane |
| `/admin/suppliers` | SuppliersView | CRUD partenaires unifiés : sourcing, personnalisé, logistique, relais, hub | Legacy live | Sourcing ne couvre que les partenaires sourcing | **LEGACY_REQUIRED** | Catalogue / Réseau → Partenaires |
 
### 2.5 Back Office — CONFIGURATION

| Route Legacy | Vue | Fonction réelle | État runtime actuel | Destination Canonical | Couverture | Cible navigation future |
|---|---|---|---|---|---|---|
| `/admin/settings` | SettingsView | Règles, taxes, dimensions, audit | Canonical direct, rollback Legacy | Paramètres | **COVERED** | Configuration → Paramètres |
| `/admin/simulator` | SimulatorView | Moteur de simulation staging : 14 scénarios, start/stop/cleanup/journal | Legacy live | aucune surface Canonical équivalente complète | **LEGACY_REQUIRED** | Configuration → Simulation |
| `/admin/shared-carts` | SharedCartsView | Support paniers partagés : statut, détail, contributions, audit, prolongation/expiration/note | Legacy live | Client 360 / Commerce couvre seulement une partie | **LEGACY_REQUIRED** | Commerce → Partages |

## 3. Surfaces historiques déjà retirées du registre principal

Ces surfaces ont déjà été absorbées et ne doivent pas être recréées comme applications autonomes.

| Ancienne surface | Destination |
|---|---|
| ProductsView | Catalogue Workspace + Product 360 |
| CategoriesView | Catalogue Workspace |
| CatalogApprovalView | Curation Catalogue |
| SourcingView | Sourcing Workspace |
| SourcingScannerView | Sourcing Workspace |
| ImportRuntimeView | Cockpit imports Canonical |

Principe : elles peuvent redevenir **entrées visibles de navigation** si cela aide la compréhension, mais elles doivent pointer vers une rubrique/section Canonical existante.

## 4. Capacités additionnelles hors registre des 26 routes

### Applications externes

Le Legacy exposait aussi :

- `/hub` — Application Hub ;
- `/relais` — Application Relais.

Ces applications ne sont pas des dashboards. Elles restent des surfaces d'exécution terrain distinctes.

### Seed / Reset

L'ancien Control Tower expose un outil Seed / Reset.

Le Canonical l'a réintroduit avec garde-fou staging :

- visible uniquement si le serveur annonce `KOMERCE_ENV=staging` ;
- reset borné au mode commandes ;
- seed explicitement confirmé.

Cette capacité doit rester dans **Configuration**, jamais dans un domaine métier.

## 5. Vue quantitative

Sur les **26 routes du registre Legacy principal** :

- **7** restent servies directement par Legacy :
  - Santé ;
  - Ventes ;
  - Transitaire ;
  - Douane ;
  - Fournisseurs ;
  - Simulateur ;
  - Paniers partagés.
- **1** est orpheline côté HTML :
  - Fournisseurs catalogue / Providers.
- **18** sont déjà Canonical directes ou redirigées vers Canonical.

En couverture fonctionnelle, la situation est différente : plusieurs des 18 routes redirigées restent **PARTIAL** ou **COVERED_BUT_HIDDEN**.

Le problème principal n'est donc pas seulement le cutover technique. C'est la perte de **visibilité de la capacité métier**.

## 6. Architecture cible après inventaire

Le modèle cible ne doit pas restaurer CT et BO comme deux applications séparées.

Il doit conserver le Canonical et réintroduire la distinction conceptuelle :

### Cockpits — comprendre / décider

- Pilotage
- Commerce
- Opérations
- Finance
- Imports
- Catalogue
- Marchés

Chaque cockpit suit la grammaire :

```text
Situation → Flux réel → Décisions ouvertes → Exceptions → Drill-down / historique
```

### Workspaces — traiter / exécuter

- Sourcing
- Curation Catalogue
- Clients / Partages
- Hub / Relais
- Inventaire
- Expéditions
- Douane
- Comptabilité
- Atelier économique
- Paramètres
- Simulation staging

### Entity 360 — expliquer un objet

- Product 360
- Order 360
- Client 360

Le Legacy devient la référence de **densité, hiérarchie et lisibilité**, pas l'architecture runtime.

## 7. Carte de navigation à dériver de cet inventaire

La future sidebar doit montrer les capacités et non le nombre de runtimes.

### DASHBOARDS

- Pilotage
- Commerce
- Opérations
- Finance

### PILOTAGE

- Activité / Santé
- Ventes
- Prévisions
- Action Center

### COMMERCE

- Commandes
- Clients
- Partages
- Litiges / remboursements
- Wallet

### CATALOGUE

- Cockpit imports
- Produits
- Curation
- Sourcing
- Sources / fournisseurs catalogue
- Partenaires fournisseurs

### OPÉRATIONS

- Hub / Relais
- Inventaire
- Expéditions
- Transit
- Douane
- Logistique

### FINANCE

- Comptabilité
- Factures
- Coûts
- Économie
- Atelier économique
- Stratégie prix
- Carte économique

### MARCHÉS

- Accès pays
- Autonomie marché
- Catalogue pays
- Équipe / réseau
- Offre locale

### CONFIGURATION

- Paramètres
- Simulation
- Reset / Seed — staging uniquement

## 8. Points à auditer avant toute suppression Legacy supplémentaire

Priorité 1 — aucune suppression :

1. **SalesView** — la richesse ventes/cohortes/funnel n'est pas encore prouvée absorbée ;
2. **SanteView** — corrélations transverses encore spécifiques ;
3. **TransitaireView** — actions bulk/historique transit ;
4. **CustomsView** — workflow douane terrain complet ;
5. **SuppliersView** — partenaires multi-familles ;
6. **SharedCartsView** — actions support ;
7. **SimulatorView** — outil staging ;
8. **ProvidersView** — route orpheline mais capacité opérateur encore utile.

Priorité 2 — preuve de couverture :

- CostingView ;
- EconomicView ;
- PilotageFinView.

## 9. Règle de reprise du chantier

Aucune ancienne entrée n'est supprimée parce qu'une route redirige.

Pour chaque capacité :

```text
besoin métier
→ vérité serveur propriétaire
→ cockpit de lecture
→ workspace d'action
→ drill-down
→ visibilité sidebar
→ preuve de couverture
```

La route Legacy n'est supprimable que lorsque la capacité est **COVERED** et que son point d'entrée Canonical est visible et compréhensible.

## 10. Décision

L'inventaire confirme la direction :

> **Canonical pour l'architecture et les autorités métier.  
> Legacy pour le langage visuel, la densité et la compréhension globale.  
> Cockpit Import comme grammaire de pilotage commune.**

La prochaine étape n'est pas de recréer les 26 vues.

La prochaine étape est de construire, à partir de cet inventaire, la **sidebar Canonical Legacy-style** qui rend toutes ces capacités visibles et les route vers les cockpits/workspaces/360 réellement propriétaires.
