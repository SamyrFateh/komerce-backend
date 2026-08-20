# DOCTRINE ADMIN & DASHBOARDS KOMERCE

**Version canonique ordonnée — v1.5 — Août 2026**  
**Statut : FIGÉE sur les vérités métier et la frontière Legacy / Canonical.** LOT 1B-1 transport est clos sous `DELTA TOTAL == DELTA EXPLIQUÉ` et Golden TARGET promu. Le chantier UI repart désormais sur un runtime **greenfield** : `public/dashboards/canonical/**`. Les deux générations précédentes restent disponibles comme référence/rollback mais ne sont plus des bases de développement.

> Ce document remplace le brouillon de doctrine, le verdict initial du challenge admin et l'hypothèse `OverviewShell` construite dans l'admin existant. Les décisions économiques et de sécurité déjà figées restent valides ; seule la stratégie UI est recadrée par l'état réel du repo.

---

## PARTIE 0 — Verdict de validation

Le repo contient aujourd'hui **deux générations historiques distinctes** avant le nouveau canonique :

| Génération | Chemin | Statut | Règle |
|---|---|---|---|
| **Legacy 0** | `public/dashboards/admin-legacy/**` | deprecated / historique | conservation, rollback, aucun nouveau développement |
| **Legacy 1** | `public/dashboards/admin/**` | runtime actuel | maintenance corrective uniquement jusqu'au cutover |
| **Canonical** | `public/dashboards/canonical/**` | greenfield | seule cible de tout nouveau développement dashboard |

Le recadrage est donc : **on ne termine plus la migration Legacy 0 → Legacy 1 et on ne construit pas le canon dans Legacy 1.** On extrait des anciennes vues leurs besoins et leurs contrats utiles, puis on reconstruit les quatre dashboards cibles sur un socle autonome qui réutilise les vérités backend, jamais le code UI historique.

| Affirmation du brouillon | Verdict | Preuve dans le code |
|---|---|---|
| SanteView est la vue transverse historique la plus corrélée | ✅ Confirmée | `SanteView` consomme 8 sources (`getOps`, `getFinance`, `getClients`, `getSales`, `getCashReconciliation`, `getCashUncollected`, `getCustomsRatesEffective`, `getFinanceConfig`) — **source de besoins**, plus base de code à migrer |
| Pilotage et Santé sont concurrents | ✅ Confirmée | `PilotageView` n'appelle que `getUnified` (`/api/admin/dashboard/unified`) ; les deux alimentent l'inventaire fonctionnel du futur Pilotage, aucun des deux n'est repris comme fondation UI |
| Deux moteurs de problèmes concurrents (Problems vs Signals) | ✅ Confirmée | `ProblemsView` recalcule en JS depuis `/api/orders` + `/api/v2/parcels/reconciliation` ; `ActionCenterView` consomme le service `signals`. **ProblemsView viole activement la doctrine §I-6** |
| Moteurs dédiés douane & risque existent | ✅ Confirmée | `routes/admin-customs-categories.js` + `services/customs-classification.js` (autorité douane) ; `routes/admin-risk-provisions.js` + migration 037 (autorité risque) |
| Migration finance_config → cost_components à mi-chemin | ✅ Confirmée | `finance_config` lu par **20** modules, `cost_components` par **4** seulement |
| Éditeurs Taxes/Dimensions fantômes | ✅ Confirmée | `routes/admin-pricing-matrices.js` écrit `pricing_category_taxes`/`pricing_category_dims` qu'aucun moteur ne lit ; `SettingsView` les édite via `putSettingsTaxes/Dims` |
| Golden CDR | ✅ Désormais réel | harnais CURRENT/TARGET + promotion explicite ; LOT 1B-1 transport fermé avec 13/13 témoins expliqués |
| Les endpoints des 3 Entity 360 existent déjà | ⚠️ **Corrigée** | **Client** : oui, endpoint propre `/api/dashboard/clients/detail`. **Order** : données éclatées sur 3 endpoints scopés par rôle. **Product** : le plus faible, seul `/products/:id/variants` (sourcing) existe |
| Fret doublement valorisé | ✅ Corrigé en 1B-1 | le fret canonique est désormais DEDICATED au moteur transport ; le double freight générique a été retiré sous preuve de delta |
| Fret W/M | ✅ Corrigé en 1B-1 | SEA/AIR partagent désormais une mesure canonique W/M ; coût et prix commercial sont séparés |

**Conséquences d'ordre :**

1. Les anciennes vues sont des **témoins fonctionnels**, pas des unités de migration. On n'absorbe pas `SanteView` ou `ControlTowerView` par copie : on vérifie que leurs besoins légitimes sont couverts par les quatre surfaces cibles.
2. Les contrats et agrégateurs backend prouvés restent réutilisables. Le reset est **UI**, pas métier.
3. `ProblemsView` reste une dette de vérité à analyser : ses règles utiles doivent rejoindre `signals` si elles sont légitimes, jamais être recopiées dans le nouveau frontend.
4. Le style visuel Komerce actuel reste une **référence de rendu**, mais aucun CSS/composant historique n'est importé dans `canonical/**`.

---

# PARTIE I — PRINCIPES (frozen)

## I-1. Finalité

L'Admin Komerce est le système de **pilotage et d'exploitation**. Il permet au responsable de :
comprendre si Komerce fonctionne, identifier ce qui exige une action, comprendre pourquoi, agir sur le bon levier, constater l'effet, investiguer un client / une commande / un produit — **sans connaître l'architecture technique interne**.

L'Admin n'est ni une collection de rapports, ni une collection de formulaires.

## I-2. Les quatre seules natures de surface

Toute fonctionnalité Admin appartient à **exactement une** de ces natures :

| Nature | Répond à | Rôle | Règle |
|---|---|---|---|
| **A — Overview Dashboard** | une question globale | observe, corrèle, alerte, oriente | une question globale = un dashboard ; n'exécute pas de workflow |
| **B — Workspace** | « qu'est-ce que je dois faire ici ? » | traiter, modifier, affecter, approuver, expédier, rapprocher, configurer | une tâche métier = un workspace |
| **C — Entity 360** | « qu'est-ce qui s'est passé avec cet objet ? » | réunit les infos utiles sans les dupliquer | un objet métier = un 360 |
| **D — Business Variable** | « sur quel levier puis-je agir ? » | modifie le comportement d'un moteur / une politique | un levier = une variable |

## I-3. Règle anti-prolifération

Une nouvelle capacité **n'obtient pas automatiquement sa page**. Avant toute surface, répondre dans l'ordre :

```
Info d'un Dashboard existant ?   → non ↓
Action d'un Workspace existant ? → non ↓
Facette d'un Entity 360 existant ? → non ↓
Nouveau domaine réellement autonome ?  → oui seulement ici : nouvelle surface
```

## I-4. Le modèle des variables

**a) Toute valeur affichée a une nature connue :**

| Type | Sens | Éditable ? | Exemples |
|---|---|---|---|
| MEASURE | valeur constatée | non | taux retour réel, conversion réelle, panier réel |
| OBJECTIVE | résultat souhaité | oui | CA cible, marge cible |
| POLICY | décision métier | oui | seuil livraison gratuite, politique fidélité, seuil d'alerte |
| ASSUMPTION | hypothèse (donnée réelle absente) | oui, **explicitement marquée hypothèse** | délai transit estimé, articles moyens/colis |
| COST | coût économique | selon autorité (voir I-5) | fret, packaging, hub, paiement |
| RISK | provision de risque | selon autorité (voir I-5) | retour, casse, impayé, démarque |
| DERIVED | résultat calculé | **jamais directement** | CDR, seuil rentabilité, marge calculée |

> Trajectoire : `ASSUMPTION → (données suffisantes) → MEASURED CALIBRATION`.

**b) Une variable = une seule vérité runtime.** Chaque variable porte :
`SOURCE_OF_TRUTH` · `CONSUMED_BY` · `DISPLAY_IN` · `EDIT_IN` · `OWNER`.

**c) Le catalogue des variables est une carte, pas une base.** Il contient les métadonnées de gouvernance, **jamais `value`**. La valeur reste dans sa source canonique.

## I-5. Autorité des coûts (OWNED / DEDICATED / DERIVED)

Pour **chaque composante du CDR, une seule autorité** produit la valeur.

| Famille | Autorité | Nature |
|---|---|---|
| purchase, sourcing, hub, packaging, distribution, relay, payment, overhead | `cost_components` | **OWNED** |
| customs | moteur douane | **DEDICATED** |
| risk | `risk_provisions` | **DEDICATED** |
| freight | moteur `transport-rails` (SEA/AIR, W/M canonique) | **DEDICATED** |
| CDR, seuils, marge calculée | calcul | **DERIVED** |

**Règle** : `cost_components` ne porte jamais une catégorie DEDICATED.

**Transport 1B-1 figé.** Le moteur porte par rail une mesure W/M canonique et deux valeurs distinctes : **coût** et **prix commercial**. Le CDR consomme uniquement le coût ; le checkout consomme le prix commercial. Le Golden officiel protège désormais cette vérité.

## I-6. Doctrine économique des dashboards

Les dashboards **n'inventent aucune vérité économique**. Chaîne obligatoire :

```
SOURCE MÉTIER → MOTEUR → AGRÉGATEUR → DASHBOARD
```

Interdit : `Dashboard → recalcul métier spécifique en JavaScript`.

## I-7. Correction de vérité ≠ régression

Deux types de migration, à ne jamais confondre :

- **Migration de structure** : `BEFORE == AFTER`.
- **Correction de vérité métier** : `BEFORE != AFTER`, mais `DELTA TOTAL == DELTA EXPLIQUÉ`.

## I-8. Migration additive

Aucune capacité métier ne disparaît au motif que « la nouvelle archi est plus propre ».

Pour le **backend / métier** :

```
INVENTORIER → MAPPER → RECONSTRUIRE/ABSORBER → TESTER → PROUVER → SUPPRIMER
```

Pour la **nouvelle génération UI**, la règle est différente :

```
INVENTORIER LE BESOIN → IDENTIFIER LA SOURCE CANONIQUE → RÉEXPRIMER DANS CANONICAL → PROUVER LA COUVERTURE
```

On ne migre pas une ancienne vue comme unité technique. `SanteView`, `PilotageView`, `ControlTowerView`, etc. restent disponibles comme témoins jusqu'au cutover, puis sont supprimables lorsque leurs besoins sont couverts.

## I-9. UI canonique — frontière physique

Trois générations coexistent temporairement :

```
admin-legacy/**  → Legacy 0 → deprecated
admin/**         → Legacy 1 → production gelée / correctifs uniquement
canonical/**     → nouvelle génération → seul développement autorisé
```

Le nouveau système repose sur :

- un **runtime admin canonique unique** ;
- un **DashboardSchema déclaratif** ;
- un renderer minimal ;
- une liste fermée de primitives ;
- quatre dashboards : Pilotage, Commerce, Opérations, Finance ;
- Workspaces et Entity 360 séparés des dashboards.

**Interdiction absolue** : `canonical/**` n'importe aucun JS, CSS ou composant de `admin/**` ou `admin-legacy/**`.

Le rendu historique peut servir de **référence visuelle** : densité, hiérarchie, sobriété, langage Komerce. Mais cette continuité est reproduite par les propres tokens/primitives du canonique, jamais par héritage technique.

## I-10. Doctrine résumée

> Le Dashboard observe. Le Workspace agit. Le 360 explique. La Variable pilote. Le moteur calcule.
> Une donnée a une seule vérité runtime. Le nouveau frontend consomme cette vérité sans la redériver.
> Les deux générations historiques sont des témoins et des rollbacks, pas des fondations.

---

# PARTIE II — CARTE CIBLE

## II-1. Quatre Dashboards + Sécurité léger

| Dashboard | Question | Contenu | Descente vers |
|---|---|---|---|
| **1 — PILOTAGE** | Komerce va-t-il bien, où agir ? | activité, CA, cash, marge, commandes, pipeline, clients, incidents critiques, trajectoire, écarts aux objectifs | Commerce · Operations · Finance · Action Center · Entity 360 |
| **2 — COMMERCE** | Que vend-on, à qui, ça marche ? | ventes, clients, catalogue, conversion, récurrence, fidélité, panier moyen, catégories, produits, zones, paiements | Catalogue WS · Client 360 · Product 360 |
| **3 — OPÉRATIONS** | Quoi traiter, où sont les commandes ? | volumes, pipeline, bloquées, retards, SLA, exceptions, inventaire, colis, transit, relais | Workspaces Ops · Order 360 |
| **4 — FINANCE** | Où est l'argent, gagne-t-on de l'argent ? | **Économie** (prix, coûts, CDR, marge, rentabilité, projection, charges) **‖ Trésorerie** (facturé, payé, à encaisser, rapproché/non, impayés) | Finance/Compta WS · Pricing WS |

**Sécurité** : pas de dashboard autonome au départ. Client 360 / Authentification + une bande sécurité dans Pilotage ; surface dédiée seulement si le volume le justifie.

## II-2. Six Workspaces

1. **Operations / Hub-Relais** — hub, inventaire, affectations, réception, préparation, relais, collecte.
2. **Expéditions & Douane** — transitaire, shipments, douane, catégories douanières, taxes, dimensions logistiques, suivi transit.
3. **Catalogue** — produits, catégories boutique, approbations, qualité.
4. **Sourcing** — synthèse, produits, candidats, scanner, fournisseurs, historique.
5. **Pricing** — construction, composants de coût, risques, stratégie, carte économique, simulation, historique.
6. **Finance / Comptabilité** — comptabilité, factures, rapprochements, encaissements, charges, exceptions.

## II-3. Trois Entity 360 (état réel des données)

| 360 | Endpoint aujourd'hui | Travail réel |
|---|---|---|
| **Client 360** | `/api/dashboard/clients/detail` | identité, commerce, finance, partage, auth, sécurité, timeline |
| **Order 360** | éclaté sur `hub-dashboard`, `admin-costing`, `relay-dashboard` | agrégation : résumé, client, articles, prix/paiement/coût/marge, logistique, incidents, audit |
| **Product 360** | `/products/:id/variants` partiel | à construire : identité, variantes, SKU, stock, sourcing, fournisseurs, prix, CDR, marge, perf, audit |

On n'invente pas Payment360 / Invoice360 / SharedCart360 / Relay360 / Wallet360 : ce sont des facettes.

## II-4. Configuration n'est pas un dépotoir

Une variable est éditée **dans le domaine qui la possède**. La config générale ne garde que les règles réellement transverses.

## II-5b. Frontière Dashboard Finance ↔ Workspace Finance/Compta

- **Dashboard Finance** = comprendre, lecture seule.
- **Workspace Finance/Compta** = exécuter les actes de clôture de l'argent.
- L'encaissement au point de collecte reste dans Operations/Hub-Relais.

## II-5. Un seul Action Center

```
SIGNALS → ACTION CENTER
```

Les règles légitimes des anciennes surfaces doivent converger vers `signals`, jamais être réimplémentées localement dans `canonical/**`.

---

# PARTIE III — INVENTAIRE DES 30 SURFACES LEGACY

Base factuelle : `docs/DASHBOARDS_360.md`.

> **Changement de sens important** : la table ci-dessous n'est plus un plan de migration de fichiers. Elle sert à savoir **quels besoins doivent survivre**. Les anciennes vues ne sont pas copiées, importées ni portées une à une.

| # | Vue actuelle | Besoin cible | Destination canonique |
|---|---|---|---|
| 1 | SanteView | synthèse transverse | Pilotage |
| 2 | PilotageView | KPIs globaux / objectifs | Pilotage |
| 3 | ControlTowerView | top signaux / pipeline | Pilotage + Opérations |
| 4 | SalesView | performance commerciale | Commerce |
| 5 | ClientsView | liste + investigation client | Commerce + Client 360 |
| 6 | OrdersLogisticsView | pipeline commande/logistique | Opérations |
| 7 | EconomicView | santé économique | Finance |
| 8 | CostingView | coût rendu / variance | Finance + Pricing WS |
| 9 | PilotageFinView | projection / mix | Finance |
| 10 | InvoicesView | factures / trésorerie | Finance + Finance WS |
| 11 | AccountingView | comptabilité | Finance + Finance WS |
| 12 | HubRelaisView | exploitation hub/relais | Operations WS |
| 13 | InventoryView | inventaire | Operations WS |
| 14 | TransitaireView | transit | Expéditions WS |
| 15 | CustomsView | douane | Expéditions & Douane WS |
| 16 | CategoriesView | catalogue catégories | Catalogue WS |
| 17 | ProductsView | produits | Catalogue WS + Product 360 |
| 18 | CatalogApprovalView | approbation catalogue | Catalogue WS |
| 19 | SourcingView | sourcing | Sourcing WS |
| 20 | SourcingScannerView | scanner | Sourcing WS |
| 21 | SuppliersView | fournisseurs | Sourcing WS |
| 22 | PricingView | construction du prix | Pricing WS |
| 23 | PricingWorkshopView | coût/config | Pricing WS |
| 24 | PricingStrategyView | stratégie | Pricing WS |
| 25 | EconomicFlowView | carte économique | Pricing WS |
| 26 | SimulatorView | simulation | Pricing WS |
| 27 | ActionCenterView | signaux/action center | Action Center |
| 28 | ProblemsView | règles d'exception à auditer | `signals` + Action Center |
| 29 | SharedCartsView | partage client | Client 360 / Commerce |
| 30 | SettingsView | variables disparates | domaines propriétaires |

**Bilan cible** : 4 dashboards + 6 workspaces + 3 Entity 360 + 1 Action Center, sans héritage UI des 30 surfaces.

---

# PARTIE IV — PLAN D'ATTAQUE

## Paliers déjà acquis

- LOT 0 : cartographie / harnais.
- LOT 1A : intégrité silencieuse.
- LOT 1B-1 : transport/fret canonique, delta 13/13 expliqué, Golden TARGET promu.

## LOT 2-RESET — frontière Legacy / Canonical

Créer `public/dashboards/canonical/**`, route temporaire `/admin-next`, bootstrap session autonome et gate anti-import legacy.

**Gate** :
- aucune route `/admin/*` historique détournée ;
- aucun fichier `admin/**` ou `admin-legacy/**` modifié pour construire le nouveau système ;
- `canonical/**` ne référence aucun code/CSS legacy.

## LOT 2A-CANON — primitives fraîches

Créer dans `canonical/**` uniquement les primitives réellement nécessaires : états, Section, FilterBar, MetricStrip/KPI, AlertPanel, DataTable, ChartPanel. Reproduire le langage visuel retenu, sans copier les composants historiques.

## LOT 2B-CANON — DashboardSchema + renderer minimal

Le renderer connaît une liste fermée de blocs. Pas de dashboard builder générique. Pas de CSS dans le schema. Pas de logique métier dans le schema.

## LOT 2C-CANON — Pilotage

Premier dashboard réel. Il consomme les agrégateurs canoniques et `signals` ; il ne migre aucune ancienne vue.

## LOT 2D-CANON — preuve de couverture

Comparer Pilotage au **besoin utile** extrait de `SanteView`, `PilotageView`, `ControlTowerView` et autres témoins. Si une information légitime manque, elle est ajoutée via une source canonique ; aucun contournement legacy n'est permis.

## LOT 2E-CANON — Commerce

Deuxième configuration du même système.

## LOT 2F-CANON — Opérations

Troisième configuration du même système.

## LOT 2G-CANON — Finance

Quatrième configuration ; CDR/marge héritent du Golden économique.

## LOT 2-CUTOVER

Quand Pilotage + navigation canonique + besoins critiques sont prouvés : bascule contrôlée des routes `/admin/*` vers le nouveau runtime. Legacy 1 reste rollback pendant une fenêtre définie, puis devient supprimable.

## APRÈS CUTOVER

Client 360, Order 360, Product 360, Workspaces, Action Center et sécurité continuent sur le même runtime canonique. La purge des deux legs UI est **la dernière étape**, après preuve de remplacement.

---

# PARTIE V — DÉCISIONS HUMAINES RÉSIDUELLES

Les décisions économiques bloquantes sont tranchées : frontière Finance et fret DEDICATED/W/M/coût-vs-prix.

Restent des arbitrages de produit non bloquants pour le reset :

1. règles légitimes de `ProblemsView` à conserver dans `signals` ;
2. richesse exacte de Hub/Relais à conserver dans les workspaces ;
3. priorisation des Entity 360 après le cutover dashboard.

---

# PARTIE VI — SÉCURITÉ : PASSKEY & DÉLÉGATION

## VI-1. État réel

| Brique | État | Preuve |
|---|---|---|
| Passkey WebAuthn | ✅ livré | `routes/auth-passkey.js` : credentials, register, login, step-up |
| Step-up | ✅ réel, par fraîcheur | `middleware/require-recent-auth.js` |
| Rôles | ⚠️ scalaire plat | `req.user.role`, `requireRole([...])` |
| Niveaux K0–K3 | ⚠️ doctrine à matérialiser | session / preuve fraîche / passkey forte |
| Délégation admin | ❌ greenfield | aucune primitive scopée existante |
| Délégation client | partielle | listes/paniers partagés et wallet |

## VI-2. Échelle K0–K3

| Niveau | Signification | Mécanisme | Autorise |
|---|---|---|---|
| K0 | anonyme | aucune session | public |
| K1 | authentifié | session valide | actes courants |
| K2 | preuve fraîche | `requireRecentAuth` | actes sensibles |
| K3 | preuve forte passkey | step-up passkey | actes critiques |

## VI-3. Passkey nominale / OTP bootstrap-recovery

- Passkey = authentification nominale et step-up fort.
- OTP = amorçage et recovery.
- Enrôlement protégé par preuve fraîche.
- Les invariants WebAuthn déjà couverts restent non renégociables.

## VI-4. Délégation

Une délégation est un **grant scopé, limité dans le temps, révocable et audité**. Jamais un partage de credential ni une impersonation opaque.

Attributs : `DELEGATOR · DELEGATEE · SCOPE · LEVEL · GRANTED_VIA · EXPIRES_AT · REVOCABLE_BY · AUDIT`.

Invariants : aucun grant implicite, non-élévation, step-up pour créer/étendre, révocation immédiate, attribution au délégataire, expiration obligatoire.

## VI-5. Décisions résiduelles sécurité

Périmètre des scopes, surfaces client/admin, durées, renouvellement et seuil de K3 restent à arbitrer lors du chantier dédié.

---

# PARTIE VII — LE SYSTÈME DASHBOARD CANONIQUE

## VII-1. La frontière est le premier invariant

Le canonique ne vit **pas** dans un troisième sous-mode du vieux shell. Il est un runtime autonome :

```text
public/dashboards/canonical/
├── index.html
├── css/
├── js/
│   ├── app.js
│   ├── core/
│   ├── components/
│   └── dashboards/
└── ...
```

Interdit :

```text
canonical → admin/**
canonical → admin-legacy/**
```

Autorisé :

```text
canonical → API / agrégateurs backend canoniques
canonical → signals
canonical → auth
```

## VII-2. Pas d'OverviewShell supplémentaire

Le challenge du repo a montré que créer `OverviewShell` dans Legacy 1 aurait ajouté une nouvelle couche à deux générations déjà coexistantes. Le bon invariant n'est pas « un shell de plus », mais :

```text
Runtime canonical
      ↓
DashboardSchema
      ↓
Renderer minimal
      ↓
Primitives canoniques
```

Un nouveau dashboard est principalement un **schema**, pas une nouvelle page artisanale.

## VII-3. Les cinq zones

La grammaire visuelle reste :

1. **FilterBar** — périmètre.
2. **MetricStrip** — 4–6 chiffres clés.
3. **AlertPanel** — signaux nécessitant attention.
4. **Sections corrélées** — charts/tables/contenu explicatif.
5. **Drill** — où investiguer ou agir.

Les zones sont ordonnées mais optionnelles lorsque le besoin ne les justifie pas.

## VII-4. DashboardSchema minimal

Forme cible :

```js
const dashboard = {
  id: 'pilotage',

  filters: ['period', 'country', 'channel'],

  metrics: {
    source: 'pilotage.summary',
    pick: ['revenue', 'margin', 'cash', 'orders']
  },

  alerts: {
    source: 'pilotage.signals'
  },

  sections: [
    {
      id: 'trajectory',
      title: 'Trajectoire',
      type: 'chart',
      source: 'pilotage.trajectory'
    },
    {
      id: 'gaps',
      title: 'Principaux écarts',
      type: 'table',
      source: 'pilotage.gaps'
    }
  ],

  drill: ['commerce', 'operations', 'finance']
};
```

Ce contrat est volontairement petit. Les noms exacts seront figés en LOT 2B-CANON après le premier renderer.

## VII-5. Contrat data

- Un bloc **data-bound** (`metric`, `alert`, `chart`, `table`) déclare une `source` canonique.
- Une `Section` purement structurelle n'a pas besoin de source.
- Le schema choisit, ordonne et présente ; il ne calcule aucune vérité métier.
- Le frontend peut formatter, trier, masquer, adapter visuellement.
- Il ne recalcule jamais marge, coût, risque, statut métier ou règle opérationnelle.

## VII-6. Primitives V1

Liste minimale :

- `UIState`
- `FilterBar`
- `Section`
- `MetricStrip`
- `AlertPanel`
- `DataTable`
- `ChartPanel`

Aucune nouvelle primitive (`Ranking`, `Timeline`, `Breakdown`, etc.) sans au moins deux besoins réels ou nécessité structurelle démontrée.

## VII-7. Doctrine visuelle

LOT 2 n'est pas un redesign gratuit.

On conserve du rendu Komerce :
- densité raisonnable ;
- hiérarchie nette ;
- cartes sobres ;
- métriques très lisibles ;
- exceptions visuellement prioritaires ;
- responsive pragmatique.

Mais le canonique possède ses **propres tokens et composants**. Le style est reproduit et harmonisé ; les anciennes feuilles CSS ne sont jamais importées.

## VII-8. Les quatre configurations

| Dashboard | MetricStrip | Alertes | Corps | Drill |
|---|---|---|---|---|
| Pilotage | activité, CA, cash, marge, commandes | top `signals` | trajectoire, écarts | Commerce · Ops · Finance |
| Commerce | ventes, conversion, panier, récurrence | signals commerce | mix, cohortes, offre/client | Catalogue · Client/Product 360 |
| Opérations | volumes, bloquées, retards, SLA | signals ops | pipeline, exceptions | Workspaces Ops · Order 360 |
| Finance | marge, CDR, rentabilité, encaissement | signals finance | économie ‖ trésorerie | Finance WS · Pricing WS |

## VII-9. Héritage du Golden CDR

Les métriques économiques consomment les agrégateurs CDR protégés par le Golden. Le frontend n'a donc aucun calcul économique alternatif à maintenir.

## VII-10. Gouvernance anti-dérive

Gates à rendre bloquants :

- aucun import de `admin/**` / `admin-legacy/**` depuis `canonical/**` ;
- aucun nouveau dashboard métier créé sous les dossiers legacy ;
- types de blocs du renderer fermés ;
- source obligatoire pour tout bloc data-bound ;
- zéro recompute métier dans schema/renderer ;
- nouveau dashboard N+1 = schema + sources, pas nouveau shell/CSS bespoke.

## VII-11. Séquence

```text
2-RESET   frontière physique + /admin-next
2A-CANON  primitives propres
2B-CANON  DashboardSchema + renderer
2C-CANON  Pilotage
2D-CANON  preuve de couverture des besoins legacy
2E-CANON  Commerce
2F-CANON  Opérations
2G-CANON  Finance
CUTOVER   /admin/* → canonical après preuve
```

**Règle finale :** on ne rénove pas une troisième fois les anciens dashboards. On construit une dernière génération, puis on retire les deux précédentes quand la preuve de remplacement existe.
