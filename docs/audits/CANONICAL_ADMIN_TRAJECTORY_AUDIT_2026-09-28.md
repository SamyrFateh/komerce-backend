# Audit de trajectoire — Back Office Canonical vs Legacy

Date : 2026-09-28  
Périmètre : navigation, couverture fonctionnelle, cutover, compréhension globale du Back Office.

## 1. Verdict

La trajectoire Canonical est **bonne sur l'architecture** mais **trop agressive sur la compression de l'expérience**.

Le problème n'est pas d'avoir créé 4 dashboards + workspaces + Entity 360. Cette séparation reste saine :

- Dashboard = comprendre ;
- Workspace = agir ;
- Entity 360 = expliquer ;
- Action Center = traiter les signaux.

Le problème est qu'en passant de ~30 surfaces Legacy à 7 entrées N1, on a aussi réduit la **représentation mentale du système**. Le runtime est plus propre, mais l'utilisateur voit moins bien tout ce que Komerce sait faire.

Conclusion : **ne pas revenir à 30 applications**, mais restaurer une navigation riche qui expose les capacités réelles sans casser l'architecture Canonical.

## 2. Constat historique

Le Legacy 1 exposait 30 routes SPA réelles. Les principales familles étaient :

- Pilotage / Santé / Control Tower ;
- Sales / Clients / Shared carts ;
- Orders / Logistics / Hub / Inventory / Transitaire / Customs ;
- Products / Categories / Catalog approval ;
- Sourcing / Scanner / Suppliers ;
- Pricing / Pricing workshop / Strategy / Economic flow / Simulator ;
- Economic / Costing / Pilotage financier / Invoices / Accounting ;
- Problems / Alerts ;
- Settings.

La doctrine Canonical a volontairement réduit cet ensemble à :

- 4 dashboards : Pilotage, Commerce, Opérations, Finance ;
- 6 workspaces : Hub-Relais, Expéditions-Douane, Catalogue, Sourcing, Pricing, Finance-Comptabilité ;
- 3 Entity 360 ;
- 1 Action Center.

Cette réduction était conçue comme une **consolidation de surfaces**, pas comme une suppression de capacités.

## 3. État actuel réel

### 3.1 Navigation visible

Le N1 actuel ne montre que :

1. Dashboard
2. Atelier économique
3. Catalogue
4. Commandes
5. Marchés
6. Opérations
7. Finance

Paramètres est relégué en utilitaire.

Cette structure respecte la doctrine V3, mais elle sous-expose fortement les capacités concrètes.

### 3.2 Capacités encore présentes mais enfouies

Plusieurs capacités existent encore dans Canonical mais ne sont visibles qu'en N2, en drill, ou via URL directe :

- Commerce
- Suivi des commandes
- Clients / Client 360
- Order 360
- Product 360
- Hub / Relais
- Expéditions & Douane
- Sourcing
- Comptabilité
- Action Center

Cela produit une impression trompeuse : le Back Office semble posséder 7 fonctions alors que le système en possède beaucoup plus.

### 3.3 Capacités Legacy toujours réellement nécessaires

Le routeur HTML actuel laisse encore explicitement Legacy 1 actif pour :

- `/admin/customs`
- `/admin/suppliers`
- `/admin/sales`
- `/admin/transitaire`
- `/admin/sante`
- `/admin/shared-carts`
- `/admin/simulator`

Ces routes sont la preuve que le cutover n'est pas encore complètement terminé.

## 4. Matrice de couverture

| Besoin historique | État | Lecture d'audit |
|---|---|---|
| Pilotage | Canonical | Bien absorbé |
| Santé transverse | Legacy encore accessible | Besoin de vérifier que Pilotage restitue vraiment la compréhension transverse |
| Control Tower | Redirigé Pilotage | Structurellement cohérent |
| Sales | Legacy | Gap de couverture encore réel |
| Clients | Canonical + Client 360 | Couvert mais trop caché dans Commandes |
| Commandes | Canonical | Couvert |
| Retards | Opérations / Action Center | Couvert mais moins directement découvrable |
| Alerts / Problems | Action Center | Bonne consolidation |
| Hub / Relais | Workspace Canonical | Bien absorbé |
| Inventory | Workspace Canonical | Bien absorbé |
| Transitaire | Legacy | Gap réel |
| Douane | Legacy + workspace additif | Cutover incomplet |
| Products / Categories / Approval | Catalogue Workspace | Bien absorbé |
| Sourcing / Scanner | Sourcing Workspace | Bien absorbé |
| Suppliers | Legacy | Gap réel : partenaires multi-familles non absorbés |
| Pricing / Strategy / Economic flow | Pricing Workspace | Bien consolidé |
| Simulator | Legacy | Gap UX/fonctionnel selon usage staging |
| Costing | Redirigé Finance | Doit être revalidé comme couverture complète |
| Economic | Redirigé Pricing | Doit être revalidé comme couverture complète |
| Pilotage financier | Redirigé Finance | Doit être revalidé comme couverture complète |
| Invoices / Accounting | Accounting Workspace | Bien absorbé |
| Shared carts | Legacy | Doctrine dit Client 360 / Commerce, mais surface Legacy encore active |
| Settings | Canonical | Couvert |
| Reset / Seed | Backend présent, hors nav | À exposer staging uniquement |

## 5. Point de vigilance majeur : le cutover a dépassé la documentation

Le contrat `DASHBOARD_CUTOVER_2.md` indique encore que :

- Costing détaillé ;
- Economic ;
- Pilotage financier

devaient rester Legacy tant que leur couverture n'était pas prouvée.

Mais le routeur actuel redirige déjà :

- `/admin/costing` → `/admin/finance`
- `/admin/economic` → `/admin/workspaces/pricing`
- `/admin/pilotage-fin` → `/admin/finance`

Le code mentionne des lots `4S / 4T`, mais aucune preuve documentaire correspondante n'a été retrouvée dans l'audit.

Ce n'est pas nécessairement une erreur de produit, mais c'est une **dette de preuve** : soit ces absorptions ont été réellement validées et la documentation doit être remise à niveau, soit le cutover a couru devant la démonstration de couverture.

## 6. Problème de compréhension globale

La doctrine V3 répond très bien à :

> « Dans quel domaine suis-je ? »

Mais moins bien à :

> « Qu'est-ce que le Back Office Komerce sait faire ? »

C'est le cœur du problème actuel.

Un opérateur ne doit pas avoir besoin de connaître :
- les N2 cachés ;
- les drills ;
- les URLs historiques ;
- la doctrine de parentage ;

pour savoir qu'il existe un module Douane, Litiges, Clients, Sourcing, Comptabilité ou Hub.

L'architecture informationnelle actuelle est donc **correcte pour le parentage**, mais **trop pauvre pour la découvrabilité**.

## 7. Recommandation cible

Conserver le modèle Canonical, mais faire évoluer la sidebar vers une représentation métier plus riche.

### Pilotage
- Dashboard
- Activité
- Ventes
- Retards
- Prévisions
- Action Center

### Commerce
- Commandes
- Clients
- Litiges
- Remboursements
- Wallet

### Catalogue
- Produits
- Catégories
- Sourcing
- Fournisseurs

### Opérations
- Hub / Relais
- Inventaire
- Expéditions
- Douane
- Logistique

### Finance
- Vue Finance
- Comptabilité
- Atelier économique
- Coûts

### Marchés
- Accès pays
- Autonomie marché
- Catalogue pays
- Équipe / réseau selon capacités réelles

### Configuration
- Paramètres
- Reset / Seed uniquement en staging

Important : ces entrées ne doivent **pas** recréer 30 runtimes. Elles peuvent cibler :
- une surface Canonical existante ;
- un N2 ;
- une vue locale ;
- un Entity 360 ;
- ou temporairement une surface Legacy encore non absorbée.

La sidebar redevient donc une **carte des capacités**, pas une projection directe du nombre de runtimes.

## 8. Règle de décision pour la suite

Pour chaque ancienne capacité :

1. Le besoin existe-t-il encore ?
2. La vérité métier est-elle déjà Canonical ?
3. La surface actuelle permet-elle de la comprendre ou de l'exécuter complètement ?
4. Est-elle visible dans la navigation ?
5. Si elle est absorbée, la couverture est-elle prouvée ?
6. Si elle ne l'est pas, Legacy reste explicitement visible jusqu'au remplacement.

Aucune capacité ne doit disparaître simplement parce qu'elle a été fusionnée techniquement.

## 9. Staging : Reset / Seed

Le backend expose toujours `POST /api/admin/reset`.

Le routeur backend protège déjà ce comportement :
- réservé admin ;
- bloqué en production par le garde environnement ;
- prévu pour dev/staging.

Il est donc cohérent de réintroduire une entrée **Reset / Seed** dans la zone Configuration sur staging, à condition que sa visibilité UI soit elle aussi explicitement conditionnée par l'environnement et qu'elle ne puisse pas apparaître en production.

## 10. Décision recommandée

Ne pas annuler Canonical.

Ne pas restaurer le Legacy comme architecture.

**Corriger le point où la consolidation technique est devenue une compression de compréhension.**

La bonne cible est :

> Canonical pour l'architecture, Legacy pour la lisibilité opérationnelle et la richesse de navigation.

Avant toute nouvelle suppression Legacy, produire une matrice de couverture exécutable pour les 30 besoins historiques, avec quatre statuts seulement :

- COVERED
- COVERED_BUT_HIDDEN
- PARTIAL
- LEGACY_REQUIRED

La purge Legacy ne devient autorisée que lorsque aucun besoin n'est PARTIAL ou LEGACY_REQUIRED.


## 11. Matrice exhaustive des 30 besoins Legacy

Convention :

- **COVERED** : besoin réexprimé et accessible dans Canonical.
- **COVERED_BUT_HIDDEN** : besoin réexprimé mais insuffisamment visible dans la navigation.
- **PARTIAL** : une partie du besoin est absorbée, mais la couverture ou la preuve n'est pas complète.
- **LEGACY_REQUIRED** : le besoin dépend encore explicitement d'une surface Legacy.

| # | Vue Legacy / besoin | Destination actuelle | Statut audit | Visibilité actuelle | Décision de navigation |
|---:|---|---|---|---|---|
| 1 | SanteView — synthèse transverse | Pilotage | **PARTIAL** | faible | Exposer **Activité / Santé** comme entrée de lecture vers Pilotage ou vue locale dédiée |
| 2 | PilotageView — KPI globaux / objectifs | Pilotage | **COVERED** | visible | Garder **Dashboard** |
| 3 | ControlTowerView — top signaux / pipeline | Pilotage + Opérations + Action Center | **COVERED_BUT_HIDDEN** | dispersée | Exposer **Action Center** et **Retards / pipeline** depuis Pilotage |
| 4 | SalesView — performance commerciale | Legacy `/admin/sales` | **LEGACY_REQUIRED** | hors Canonical | Faire revenir **Ventes** dans la navigation tant que Commerce ne couvre pas tout |
| 5 | ClientsView — liste / investigation client | `/admin/clients` + Client 360 | **COVERED_BUT_HIDDEN** | enfouie sous Commandes | Exposer **Clients** explicitement |
| 6 | OrdersLogisticsView — pipeline commande/logistique | Opérations | **COVERED_BUT_HIDDEN** | agrégé | Exposer **Logistique / Retards** comme sous-entrée claire |
| 7 | EconomicView — santé économique | redirect Pricing WS | **PARTIAL** | masquée par redirect | Exposer **Économie** tant que la preuve d'absorption n'est pas formalisée |
| 8 | CostingView — coût rendu / variance | redirect Finance | **PARTIAL** | masquée par redirect | Exposer **Coûts** comme rubrique Finance / Atelier économique |
| 9 | PilotageFinView — projection / mix | redirect Finance | **PARTIAL** | masquée par redirect | Exposer **Prévisions** dans Finance/Pilotage |
| 10 | InvoicesView — factures / trésorerie | Accounting Workspace | **COVERED_BUT_HIDDEN** | sous Finance | Exposer **Factures** ou rendre cette capacité évidente dans Comptabilité |
| 11 | AccountingView — comptabilité | Accounting Workspace | **COVERED** | N2 seulement | Garder **Comptabilité**, plus visible |
| 12 | HubRelaisView — exploitation hub/relais | Operations Workspace | **COVERED_BUT_HIDDEN** | N2 Opérations | Exposer **Hub / Relais** |
| 13 | InventoryView — inventaire | Operations Workspace | **COVERED_BUT_HIDDEN** | absorbé dans Hub/Relais | Exposer **Inventaire** comme vue/rubrique du workspace |
| 14 | TransitaireView — transit | Legacy `/admin/transitaire` | **LEGACY_REQUIRED** | hors Canonical | Exposer **Expéditions / Transit** même si la cible reste temporairement Legacy |
| 15 | CustomsView — douane | Legacy `/admin/customs` + workspace additif | **LEGACY_REQUIRED** | ambiguë | Exposer **Douane** explicitement jusqu'au cutover complet |
| 16 | CategoriesView — catégories catalogue | Catalog Workspace | **COVERED_BUT_HIDDEN** | absorbée | Exposer **Catégories** dans Catalogue |
| 17 | ProductsView — produits | Catalog Workspace + Product 360 | **COVERED_BUT_HIDDEN** | absorbée | Exposer **Produits** |
| 18 | CatalogApprovalView — approbation catalogue | Catalog Workspace | **COVERED_BUT_HIDDEN** | absorbée | Exposer **Approbations** si le workflow reste opérationnel |
| 19 | SourcingView — sourcing | Sourcing Workspace | **COVERED_BUT_HIDDEN** | N2 Opérations | Exposer **Sourcing** clairement |
| 20 | SourcingScannerView — scanner / candidats | Sourcing Workspace | **COVERED_BUT_HIDDEN** | vue interne | Exposer **Scanner / Candidats** dans Sourcing, pas nécessairement N1 |
| 21 | SuppliersView — fournisseurs / partenaires | Legacy `/admin/suppliers` | **LEGACY_REQUIRED** | hors Canonical | Exposer **Fournisseurs** jusqu'à vraie absorption multi-familles |
| 22 | PricingView — construction prix | Pricing Workspace | **COVERED** | visible comme Atelier économique | Garder **Atelier économique** |
| 23 | PricingWorkshopView — coûts/config | Pricing Workspace | **COVERED_BUT_HIDDEN** | vue interne | Exposer **Coûts / Construction** comme N2 |
| 24 | PricingStrategyView — stratégie | Pricing Workspace | **COVERED_BUT_HIDDEN** | vue interne | Exposer **Prix & contribution / Stratégie** |
| 25 | EconomicFlowView — carte économique | Pricing Workspace | **COVERED_BUT_HIDDEN** | vue interne | Exposer **Carte économique** ou l'intégrer clairement à Atelier |
| 26 | SimulatorView — simulation | Legacy `/admin/simulator` | **LEGACY_REQUIRED** | hors Canonical | Exposer **Simulation** ; staging en particulier |
| 27 | ActionCenterView — signaux / actions | Action Center | **COVERED_BUT_HIDDEN** | parent Dashboard | Exposer **Action Center** explicitement |
| 28 | ProblemsView — exceptions | Action Center / signals | **COVERED** | absorbée | Ne pas recréer Problems ; montrer ses signaux via Action Center |
| 29 | SharedCartsView — partages | Legacy `/admin/shared-carts` + doctrine Client 360/Commerce | **PARTIAL** | peu visible | Exposer **Partages** tant que la couverture Canonical n'est pas prouvée |
| 30 | SettingsView — paramètres | Canonical Settings | **COVERED** | utilitaire | Garder **Paramètres** |

### Synthèse quantitative

Sur les 30 besoins historiques :

- **5 COVERED**
- **14 COVERED_BUT_HIDDEN**
- **5 PARTIAL**
- **6 LEGACY_REQUIRED**

Le risque dominant n'est donc pas la perte brute de fonctionnalités mais la **perte de visibilité** : presque la moitié des besoins sont absorbés mais devenus difficiles à découvrir.

## 12. Ce que la nouvelle navigation doit absolument montrer

La nouvelle sidebar ne doit pas être le reflet direct des runtimes. Elle doit être la carte de capacités suivante.

### PILOTAGE
- Dashboard
- Activité
- Ventes
- Retards
- Prévisions
- Action Center

### COMMERCE
- Commandes
- Clients
- Partages
- Litiges
- Remboursements
- Wallet

### CATALOGUE
- Produits
- Catégories
- Approbations
- Sourcing
- Scanner / Candidats
- Fournisseurs

### OPÉRATIONS
- Vue d'ensemble
- Hub / Relais
- Inventaire
- Expéditions / Transit
- Douane
- Logistique

### FINANCE
- Vue Finance
- Factures
- Comptabilité
- Économie
- Coûts
- Prévisions financières
- Atelier économique

### MARCHÉS
- Accès pays
- Autonomie marché
- Catalogue pays
- Équipe / réseau selon capabilities disponibles

### CONFIGURATION
- Paramètres
- Simulation
- Reset / Seed (staging uniquement)

## 13. Règle d'implémentation de la navigation

Une entrée visible peut pointer vers :

1. une route Canonical complète ;
2. un N2 Canonical ;
3. une section locale du workspace ;
4. un Entity 360 ;
5. une route Legacy temporaire si le besoin est encore **LEGACY_REQUIRED**.

Cela évite le faux choix entre :
- « revenir à 30 pages Legacy » ;
- ou « n'afficher que 7 domaines ».

La bonne solution est une **navigation riche au-dessus d'une architecture consolidée**.

## 14. Gate de couverture à créer

Avant toute suppression d'une route Legacy, une table générée doit vérifier :

```
legacy_need
canonical_destination
coverage_status
proof
navigation_entry
rollback_path
```

Une route Legacy ne devient supprimable que lorsque :

```
coverage_status == COVERED
AND proof != null
AND navigation_entry != null
```

Pour les besoins volontairement fusionnés dans un autre écran, `navigation_entry` peut viser une rubrique ou une ancre et non une page autonome.

## 15. Prochaine étape recommandée

1. Ne pas modifier immédiatement les routes de cutover.
2. Construire la nouvelle **carte de navigation riche** à partir de cette matrice.
3. Réintroduire visuellement les besoins `LEGACY_REQUIRED` au lieu de les cacher.
4. Auditer en priorité :
   - Sales ;
   - Transitaire ;
   - Douane ;
   - Suppliers ;
   - Simulator ;
   - Shared carts ;
   - Costing / Economic / Pilotage financier.
5. Ajouter Reset / Seed uniquement sur staging.
6. Une fois la navigation visible, mesurer la couverture écran par écran avant toute nouvelle purge Legacy.
