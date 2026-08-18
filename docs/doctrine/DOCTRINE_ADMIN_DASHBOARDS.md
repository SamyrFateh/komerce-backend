# DOCTRINE ADMIN & DASHBOARDS KOMERCE

**Version canonique ordonnée — v1.4 — Août 2026**
**Statut : FIGÉE (surfaces & économie) + chapitre Sécurité (VI) + gabarit dashboard (VII, le moule).** Frontière Finance tranchée (II-5b) ; fret entièrement tranché — DEDICATED, W/M unifié, option (b) coût vs prix (I-5). Golden CDR livré (LOT 0C-eco). Décisions résiduelles non-bloquantes en Partie V et VI-5. **Prochain : suite du LOT 0 (0A matrice des surfaces, 0B inventaire des variables). Aucun chantier UI (LOT 2+) ne démarre avant validation doctrine + LOT 0.**

> Ce document remplace le brouillon de doctrine et le verdict du challenge admin. Il a été
> confronté au code réel du repo (`komerce.zip`) et à la carte générée `docs/DASHBOARDS_360.md`.
> Les affirmations porteuses sont marquées ✅ (confirmée par le code) ou ⚠️ (corrigée / précisée).

---

## PARTIE 0 — Verdict de validation

Recadrage confirmé : **on ne construit pas un nouvel admin, on termine une migration déjà largement engagée et on reconsolide des surfaces qui ont proliféré** (30 vues aujourd'hui).

| Affirmation du brouillon | Verdict | Preuve dans le code |
|---|---|---|
| SanteView est déjà la vue transverse corrélée → base du Pilotage canonique | ✅ Confirmée | `SanteView` consomme 8 sources (`getOps`, `getFinance`, `getClients`, `getSales`, `getCashReconciliation`, `getCashUncollected`, `getCustomsRatesEffective`, `getFinanceConfig`) — c'est la seule vue réellement transverse |
| Pilotage et Santé sont concurrents | ✅ Confirmée | `PilotageView` n'appelle que `getUnified` (`/api/admin/dashboard/unified`), un seul endpoint agrégateur — doublon fonctionnel de SanteView |
| Deux moteurs de problèmes concurrents (Problems vs Signals) | ✅ Confirmée | `ProblemsView` recalcule en JS depuis `/api/orders` + `/api/v2/parcels/reconciliation` ; `ActionCenterView` consomme le service `signals`. **ProblemsView viole activement la doctrine §I-6** |
| Moteurs dédiés douane & risque existent | ✅ Confirmée | `routes/admin-customs-categories.js` + `services/customs-classification.js` (autorité douane) ; `routes/admin-risk-provisions.js` + migration 037 (autorité risque) |
| Migration finance_config → cost_components à mi-chemin | ✅ Confirmée | `finance_config` lu par **20** modules, `cost_components` par **4** seulement |
| Éditeurs Taxes/Dimensions fantômes | ✅ Confirmée | `routes/admin-pricing-matrices.js` écrit `pricing_category_taxes`/`pricing_category_dims` qu'aucun moteur ne lit ; `SettingsView` les édite via `putSettingsTaxes/Dims` |
| Golden CDR déjà existant | ❌ Absent | Aucun harnais de parité `computeCDR` figé dans `tests/` — **à créer en LOT 0, c'est le prérequis de tout** |
| Les endpoints des 3 Entity 360 existent déjà | ⚠️ **Corrigée** | **Client** : oui, endpoint propre `/api/dashboard/clients/detail`. **Order** : données présentes mais **éclatées sur 3 endpoints scopés par rôle** (`hub-dashboard.js`, `admin-costing.js`, `relay-dashboard.js`) → Order 360 est un travail d'**agrégation**, pas d'invention. **Product** : le plus faible, seul `/products/:id/variants` (sourcing) existe → à **construire**. |
| Fret doublement valorisé | ✅ Confirmée | `pricing-cdr.js` lit simultanément `customs_categories`, `risk_provisions` **et** `cost_components` ; le seed 043 a créé un `fret_maritime_eur_m3` @ 180 eur dans cost_components qui double `finance_config` |
| Fret : 3 bases incohérentes, aucune ne fait le W/M | ⚠️ **Trouvé** | CDR bateau = m³ seul · commercial SEA = kg réel seul (ignore le volume, malgré le label « volume » de la doctrine transport) · seul l'air fait `max()`. Le commercial SEA sous-facture les colis denses → **bug de recette**. Justifie freight = DEDICATED au moteur `transport-rails` unifié (cf. I-5) |

**Conséquences d'ordre (ce que le verdict change au brouillon) :**

1. **L'ordre des Entity 360 est justifié par les faits, pas par confort** : Client d'abord (endpoint propre), Order ensuite (agrégation de 3 endpoints, à faire avec Operations), Product en dernier (le plus à construire). Le LOT 3 = Client est le bon premier test de `Entity360Shell`.
2. **Le golden CDR ne suffit pas comme filet de parité** : les 30 dashboards tournent sur **59 contrats non prouvés** (aucun test d'intégration ne fige la forme de réponse). Refondre les dashboards sans figer leurs contrats = refondre sans filet. → le LOT 0 doit produire **deux** harnais (voir LOT 0C).
3. **ProblemsView n'est pas qu'« à absorber »** : il enfreint aujourd'hui la doctrine « les dashboards ne recalculent pas la vérité métier ». Son traitement doit vérifier si sa logique JS **diverge** de `signals` (auquel cas c'est une *correction de vérité*, pas une simple absorption).

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
> ⚠️ Le repo confond aujourd'hui MEASURE / ASSUMPTION / config sur conversion, retours et moyennes d'allocation → à typer explicitement en LOT 0B.

**b) Une variable = une seule vérité runtime.** Chaque variable porte :
`SOURCE_OF_TRUTH` (où vit la valeur) · `CONSUMED_BY` (quels moteurs la lisent réellement) · `DISPLAY_IN` · `EDIT_IN` · `OWNER`.
> `CONSUMED_BY` est indispensable : le repo contient des éditeurs capables de modifier des tables que **plus aucun moteur ne consomme** (cf. taxes/dims).

**c) Le catalogue des variables est une carte, pas une base.** Il contient `key, label, domain, type, source_table, source_column, editable, criticality, consumed_by, display_in, edit_in, owner_role` — **jamais `value`**. La valeur reste dans sa source canonique, sinon on recrée une source de vérité concurrente (exactement ce que les migrations veulent supprimer).

## I-5. Autorité des coûts (OWNED / DEDICATED / DERIVED)

Pour **chaque composante du CDR, une seule autorité** produit la valeur.

| Famille | Autorité (verrouillée par le code) | Nature |
|---|---|---|
| purchase, sourcing, hub, packaging, distribution, relay, payment, overhead | `cost_components` | **OWNED** |
| **customs** | `customs_categories` + moteur `customs-classification` | **DEDICATED** → cost_components n'a **pas** le droit de la valoriser |
| **risk** | `risk_provisions` | **DEDICATED** → idem |
| **freight** | ⚠️ **CORRIGÉ : moteur `transport-rails` (SEA + AIR, poids taxable)** ; le CDR **consomme**, ne recalcule pas | **DEDICATED** — voir ci-dessous |
| CDR, seuils, marge calculée | calcul | **DERIVED** — jamais édité |

**Règle** : le `CHECK` interdit à `cost_components` de porter une catégorie DEDICATED — **customs, risk et freight**.

**Décision fret (corrigée — le fret avion rouvre le dossier).** Il existe **deux systèmes de fret** dans le repo, pas un :
- **Coût dans le CDR** (`pricing-cdr.js` l.196) : `volume × fret_eur_per_m3 × fx` — **bateau uniquement, volumétrique**, taux global `finance_config`. Le CDR **ignore totalement les rails**.
- **Prix de transport commercial** (`transport-rails.js` + `transport-pricing.js`, migration 118) : moteur **rail-aware** (`SEA_STANDARD` **et** `AIR_EXPRESS`), **au poids taxable** (KMF/kg, divisor volumétrique 6000 pour l'air), doctrine mature (`DOCTRINE_TRANSPORT_RAILS.md` : « aucun rail implicite », « pas d'exposition sans valorisation », « aucun tarif inventé »), `AIR_EXPRESS` **bloqué tant que `pricing_status != ACTIVE`**. Persisté dans `orders.transport_price_kmf`.

Le fret n'est donc **pas** un scalaire global : c'est une règle **poids/mesure (W/M)** — la **quantité facturable = `max(mesure native, autre mesure ramenée)`, exprimée sur l'unité de référence du rail** :
- **AIR** → unité **kg** : `max(poids réel, volume/diviseur)` — le volume est ramené au poids (diviseur ≈ 6000) ;
- **SEA** → unité **m³** : `max(volume, poids/densité_réf)` — le poids est ramené au volume.

L'unité de référence, le facteur de conversion (diviseur/densité) et le seuil sont des **POLICY par rail**, propriété du domaine `transport-rails`. Cette logique `max()` de deux mesures sur une unité de référence par rail est précisément ce qu'un composant `cost_components` générique — une seule base à la fois (`kmf_per_kg` **ou** `kmf_per_m3`) — **ne peut pas exprimer** : le fret ne peut donc pas être une ligne OWNED, il **doit** vivre dans le moteur `transport-rails`.

⚠️ **Incohérence actuelle à corriger (LOT 1B)** : le code implémente **trois bases différentes et aucune ne fait le W/M** — CDR bateau = `m³` seul (ignore le poids) ; commercial SEA = `kg` réel seul (ignore le volume, alors que `DOCTRINE_TRANSPORT_RAILS.md` déclare SEA_STANDARD « volume ») ; seul l'air fait un vrai `max()`. Le commercial SEA **sous-facture les colis denses** (bug de recette, symétrique du bug de marge avion). Le moteur `transport-rails` DEDICATED doit **unifier les trois sur la règle W/M**.

Conséquence : **freight = DEDICATED au moteur `transport-rails`** ; le CDR **consomme** la quantité facturable (W/M du rail) au lieu de recalculer un estimé volumétrique bateau ; le chemin `finance_config.fret_eur_per_m3` (l.196) devient un **fallback à retirer** une fois la consommation branchée. Le double-count meurt, le bug de marge avion est évité, et le bug de sous-facturation bateau est corrigé.

✅ **Fork tranché — option (b) (LOT 1B débloqué).** `transport-rails` porte **deux taux par rail, distincts** : un **taux de coût** (ce que Komerce paie pour déplacer la marchandise) et un **taux/prix commercial** (ce que paie le client, marge incluse). La quantité facturable (W/M du rail) est commune. **Le CDR consomme uniquement le coût** (`quantité facturable × taux de coût du rail`) ; le prix commercial reste le devis client. **On ne mélange jamais marge transport et coût transport** — conforme à I-4 (coût ≠ prix, une variable = une vérité) et I-7. Quasi gratuit : le moteur retourne déjà `taxable_weight_kg` séparément du taux, il suffit d'ajouter le taux de coût à côté du taux commercial.

## I-6. Doctrine économique des dashboards

Les dashboards **n'inventent aucune vérité économique**. Chaîne obligatoire :

```
SOURCE MÉTIER → MOTEUR → AGRÉGATEUR → DASHBOARD
```

Interdit : `Dashboard → recalcul métier spécifique en JavaScript`.
> Violation active constatée : `ProblemsView` recompute des problèmes en JS.

## I-7. Correction de vérité ≠ régression

Deux types de migration, à ne jamais confondre :

- **Migration de structure** : `BEFORE == AFTER` (le comportement ne bouge pas).
- **Correction de vérité métier** : `BEFORE != AFTER`, mais `DELTA TOTAL == DELTA EXPLIQUÉ`. **Tout écart inexpliqué est un échec.**

Critique pour le CDR : la refonte a mis en évidence des doublons économiques **actifs** (fret, risk).

## I-8. Migration additive

Aucune suppression au motif que « la nouvelle archi est plus propre ». Chaque capacité suit :

```
INVENTORIER → MAPPER → RECONSTRUIRE/ABSORBER → TESTER → PROUVER LA PARITÉ → MASQUER → SUPPRIMER
```

Capacités explicitement à protéger : règles Problems, workflows Hub/Relais, `redistribute`, calibrage d'allocation, fallback pricing (`pricing_components`), audit trails.

## I-9. UI canonique

Quatre shells seulement : `AdminShell`, `OverviewShell`, `WorkspaceShell`, `Entity360Shell`.
Primitives communes : `EntityHeader, MetricStrip, InfoCard, StatusBadge, DataTable, Timeline, Tabs, ActionBar, AlertPanel, FilterBar`.
Aucune abstraction supplémentaire sans besoin métier démontré.

**CT / BO** : la distinction métier reste (Tour de Contrôle = comprendre/arbitrer/décider ; Back Office = traiter/modifier/exécuter) mais **ce ne sont plus deux langages visuels** — même AdminShell, mêmes primitives.

## I-10. Doctrine résumée

> Le Dashboard observe. Le Workspace agit. Le 360 explique. La Variable pilote. Le moteur calcule.
> Une donnée a une seule vérité runtime. Une variable a un seul éditeur canonique, ses consommateurs sont connus, son effet s'affiche partout où c'est utile.
> Aucune capacité ne disparaît sans preuve de parité. Aucune abstraction sans besoin démontré.

---

# PARTIE II — CARTE CIBLE

## II-1. Quatre Dashboards + Sécurité léger

| Dashboard | Question | Contenu (signal, pas exécution) | Descente vers |
|---|---|---|---|
| **1 — PILOTAGE** (base : SanteView) | Komerce va-t-il bien, où agir ? | activité, CA, cash, marge, commandes, pipeline, clients, incidents critiques, trajectoire, écarts aux objectifs | Commerce · Operations · Finance · Action Center · Entity 360 |
| **2 — COMMERCE** | Que vend-on, à qui, ça marche ? | ventes, clients, catalogue, conversion, récurrence, fidélité, panier moyen, catégories, produits, zones, paiements | Catalogue WS · Client 360 · Product 360 |
| **3 — OPÉRATIONS** | Quoi traiter, où sont les commandes ? | volumes, pipeline, bloquées, retards, SLA, exceptions, inventaire, colis, transit, relais | Workspaces Ops · Order 360 |
| **4 — FINANCE** | Où est l'argent, gagne-t-on de l'argent ? | **Économie** (prix, coûts, CDR, marge, rentabilité, projection, charges) **‖ Trésorerie** (facturé, payé, à encaisser, rapproché/non, impayés) — séparation rendue **explicite** | Finance/Compta WS · Pricing WS |

**Sécurité** : **pas** de dashboard autonome au départ. Phase 1 = `Client 360/Authentification` (téléphone vérifié, passkeys, sessions, recovery, step-up, événements) + une *bande sécurité* dans Pilotage. Dashboard dédié seulement si les volumes le justifient.

## II-2. Six Workspaces

1. **Operations / Hub-Relais** — hub, inventaire, affectations, réception, préparation, relais, collecte. ⚠️ Inventorier la richesse fonctionnelle de `HubRelaisView` (une des vues les plus denses) **avant** toute fusion.
2. **Expéditions & Douane** — transitaire, shipments, douane, catégories douanières, taxes, dimensions logistiques, suivi transit.
3. **Catalogue** — produits, catégories boutique, approbations, qualité. Clic produit → **Product 360**.
4. **Sourcing** — synthèse, produits, candidats, scanner, fournisseurs, historique. (Supplier 360 plus tard si besoin.)
5. **Pricing** — workspace économique : construction, composants de coût, risques, stratégie, carte économique, simulation, historique. **Principal gain de simplification** (consolidation de ~6 surfaces).
6. **Finance / Comptabilité** — comptabilité, factures, rapprochements, encaissements, charges, exceptions. À distinguer du **Dashboard** Finance (qui sert à *comprendre*).

## II-3. Trois Entity 360 (état réel des données)

| 360 | Endpoint aujourd'hui | Travail réel | Lot |
|---|---|---|---|
| **Client 360** | `/api/dashboard/clients/detail` (propre) | assemblage : identité, commerce (commandes, LTV, panier, préférences, fidélité), finance (paiements, wallet), partage (listes, contributions), **auth** (tél, OTP, passkeys, sessions, devices), **sécurité** (recovery, step-up, échecs, révocations), timeline | LOT 3 |
| **Order 360** | ⚠️ **éclaté sur 3 endpoints** (`hub-dashboard`, `admin-costing`, `relay-dashboard`) | **agrégation** : résumé, client, articles, prix/paiement/coût/marge, hub/colis/transit/douane/relais/collecte, incidents/actions/timeline/audit | LOT 6 (avec Operations) |
| **Product 360** | ⚠️ le plus faible (`/products/:id/variants` seul) | à **construire** : identité, catalogue, variantes, SKU, stock, sourcing, fournisseurs, prix, CDR, marge, historique pricing, perf commerciale, alertes, audit | LOT 6+ |

On **n'invente pas** Payment360 / Invoice360 / SharedCart360 / Relay360 / Wallet360 : ce sont des **facettes** d'un 360 existant.

## II-4. Configuration n'est pas un dépotoir

`Settings` ne signifie jamais « tout ce qu'on peut modifier ». Une variable est éditée **dans le domaine qui la possède** :
marge cible → Pricing ; SLA transit → Operations ; objectif CA → Commerce/Pilotage config ; taxes douanières → Douane ; politique fidélité → Commerce.
La config générale ne garde que les règles **réellement transverses**.

## II-5b. Frontière Dashboard Finance ↔ Workspace Finance/Compta (tranchée sur le code)

Ligne tracée par la lecture vs l'écriture réelle. Constat : `AccountingView` et `InvoicesView` sont **100 % lecture** aujourd'hui (aucune route d'écriture). Les actes d'écriture existent ailleurs (`routes/cash.js` : `POST /deposits/:id/verify`, `/dispute`, `/deposit`, `/collect`).

- **Dashboard Finance** = *comprendre*. **Lecture seule.** Économie (CDR, marge, rentabilité, projection) ‖ Trésorerie (facturé, payé, à encaisser, rapproché/non, impayés). C'est ce que les vues actuelles sont déjà.
- **Workspace Finance/Compta** = *exécuter les actes qui closent l'argent* : vérification & dispute des dépôts, rapprochement, marquage encaissé, régularisation d'exceptions. Ces actes existent comme **API mais sans écran consolidé** → le workspace leur donne un foyer. ⚠️ **Conséquence LOT 7** : le côté exécution est **à construire**, pas seulement à consolider.
- **Garde-fou** : l'encaissement au **point de collecte** (relais, `relaisConfirmCash`, `POST /cash/collect`) reste dans **Operations/Hub-Relais** — acte opérationnel, pas acte de back-office compta. Ne pas l'aspirer dans Finance.

## II-5. Un seul Action Center

```
SIGNALS → ACTION CENTER
```

Absorbe progressivement : `ProblemsView`, l'ActionCenter existant, les alertes dispersées, les incidents redondants. **Aucune règle ne disparaît sans** inventaire → mapping → migration → test de parité → suppression.

---

# PARTIE III — RÉCONCILIATION DES 30 SURFACES

Base factuelle : `docs/DASHBOARDS_360.md` (chaîne route → vue → KmcApi → endpoint). Verdicts : **KEEP** (devient la base) · **MERGE** (fond dans une cible) · **REBUILD** (reconstruit léger) · **DISSOLVE/DELETE** (éclaté dans les domaines ou supprimé après parité).

| # | Vue actuelle | Nature | Destination cible | Verdict |
|---|---|---|---|---|
| 1 | SanteView | Dashboard | **Pilotage** (base canonique) | KEEP-base |
| 2 | PilotageView | Dashboard | Pilotage | MERGE |
| 3 | ControlTowerView | Dashboard | Pilotage (top signals) | MERGE |
| 4 | SalesView | Dashboard | **Commerce** | REBUILD |
| 5 | ClientsView | Dashboard + 360 | list → Commerce · detail → **Client 360** | SPLIT |
| 6 | OrdersLogisticsView | Dashboard | **Opérations** | MERGE |
| 7 | EconomicView | Dashboard | **Finance / Économie** | MERGE |
| 8 | CostingView | Dashboard | Finance / Économie + Pricing WS | MERGE |
| 9 | PilotageFinView | Dashboard | **Finance** (+ variables) | MERGE |
| 10 | InvoicesView | Workspace | **Finance/Compta WS** (+ Trésorerie dashboard) | MERGE |
| 11 | AccountingView | Workspace | Finance/Compta WS | MERGE |
| 12 | HubRelaisView | Workspace | **Operations/Hub-Relais WS** | KEEP (inventaire d'abord) |
| 13 | InventoryView | Workspace | Operations/Hub-Relais WS | MERGE |
| 14 | TransitaireView | Workspace | **Expéditions & Douane WS** | MERGE |
| 15 | CustomsView | Workspace | Expéditions & Douane WS | KEEP |
| 16 | CategoriesView | Workspace | **Catalogue WS** | MERGE |
| 17 | ProductsView | Workspace | Catalogue WS (+ Product 360 au clic) | MERGE |
| 18 | CatalogApprovalView | Workspace | Catalogue WS | MERGE |
| 19 | SourcingView | Workspace | **Sourcing WS** | KEEP |
| 20 | SourcingScannerView | Workspace | Sourcing WS | MERGE |
| 21 | SuppliersView | Workspace | Sourcing WS | MERGE |
| 22 | PricingView | Workspace | **Pricing WS** | KEEP |
| 23 | PricingWorkshopView | Workspace | Pricing WS | MERGE |
| 24 | PricingStrategyView | Workspace | Pricing WS | MERGE |
| 25 | EconomicFlowView | Workspace | Pricing WS (carte éco) | MERGE |
| 26 | SimulatorView | Workspace | Pricing WS (simulation) | MERGE |
| 27 | ActionCenterView | Dashboard/moteur | **Action Center** (base, service signals) | KEEP-base |
| 28 | ProblemsView | Dashboard | Action Center | REBUILD ⚠️ (viole I-6 ; vérifier divergence vs signals → correction de vérité éventuelle) |
| 29 | SharedCartsView | Workspace | facette **Client 360** / Commerce | MERGE |
| 30 | SettingsView | « dépotoir » | taxes/dims → **DELETE** (fantômes) · règles → domaines propriétaires · transverse → config générale | DISSOLVE |

**Bilan cible** : 4 dashboards + 6 workspaces + 3 entity 360 + 1 action center + config dissoute, à partir des 30 surfaces actuelles.

---

# PARTIE IV — PLAN D'ATTAQUE (gates)

> **STOP formel avant LOT 2.** Aucune ligne de refonte UI tant que ne sont pas verts :
> ① matrice finale des surfaces · ② matrice finale des variables + `CONSUMED_BY` · ③ Golden CDR CURRENT + doctrine OWNED/DEDICATED/DERIVED figée · ④ contrats des surfaces conservées figés.

## LOT 0 — Cartographie & harnais (aucune modification métier)

- **0A — Inventaire des surfaces.** Pour les 30 vues : question métier, APIs, actions, données, rôles, destination cible, verdict KEEP/MERGE/REBUILD/DELETE. → **La Partie III est le point de départ ; à compléter par vue.**
- **0B — Inventaire des variables.** Pour chaque variable : type (I-4a), source, `CONSUMED_BY`, `DISPLAY_IN`, `EDIT_IN`, scope, owner, verdict. Cible prioritaire : lever les confusions MEASURE/ASSUMPTION/config (conversion, retours, allocation).
- **0C-eco — Golden CDR CURRENT.** Harnais de référence par produit témoin (catégorie × canal), pas seulement le total : `purchase, sourcing, hub, packaging, freight, customs, transitary, distribution, relay, payment, risk, overhead, TOTAL` + `source utilisée, fallback utilisé, allocation confidence, warnings`. **N'existe pas aujourd'hui → à créer.**
- **0C-ui — Gel des contrats des surfaces conservées.** ⚠️ **AJOUT.** Figer la forme de réponse (test d'intégration) des endpoints des dashboards KEEP/MERGE — aujourd'hui **59 contrats non prouvés**. Sans ça, « prouver la parité » (I-8) est impossible pour les dashboards, seulement pour le CDR.
- **0D — Doctrine coûts.** Trancher définitivement OWNED/DEDICATED/DERIVED par famille (I-5), **dont le fret**.

**Gate LOT 0** : on sait exactement quelles surfaces & variables existent, qui les consomme, comment le CDR courant se comporte, et les contrats des surfaces gardées sont figés.

## LOT 1A — Intégrité silencieuse (`Golden CDR BEFORE == AFTER`)

Suppression des éditeurs Taxes/Dimensions fantômes ; canonisation USD FX ; désambiguïsation commission relais (3 champs → 1 règle de priorité) ; traitement propre d'`economic_variables` **après** migration de `redistribute`. ⚠️ Note : `economic_variables` est aussi lu par `dashboard-ops-queries.js` — le gel touche donc le dashboard Ops, à re-tester.

## LOT 1B — Canonisation économique (⚠️ déplace des prix)

**Une seule opération cohérente** : doctrine `cost_components` + catégories réservées (customs, risk, **freight**) + **branchement du CDR sur `transport-rails` pour le fret** (rail + poids taxable, retrait du chemin bateau l.196) + risques + migration des anciennes colonnes de coût + protections DB (`CHECK`) + retrait des doubles valorisations + adaptation CDR.
**Prérequis** : le fork « fret coût vs prix » (Partie V) doit être tranché avant de coder 1B — il détermine ce que le CDR consomme de `transport-rails`.
**On ne corrige pas le fret aujourd'hui pour le re-migrer plus tard** — une seule décision de vérité, une seule revalidation.
Validation : `GOLDEN CURRENT → migration → DIFF EXPLIQUÉ → GOLDEN TARGET APPROUVÉ`.

## LOT 2 — Primitives UI

`AdminShell / OverviewShell / WorkspaceShell / Entity360Shell` + primitives. Aucune refonte massive d'écran.

## LOT 3 — Client 360

Premier test réel de `Entity360Shell`. Choisi car endpoint propre existant, très transversal, utile immédiatement, prépare Passkey, valide commerce + wallet + commandes + sécurité sur une entité.

## LOT 4 — Pilotage

Élever SanteView en Pilotage canonique ; absorber PilotageView, PilotageFin, top signals de ControlTower **sans** reproduire Finance/Commerce/Ops. Réviser l'ADR correspondant.

## LOT 5 — Commerce

Reconstruire léger autour de Commerce/Clients/Catalogue/Fidélité ; retirer les agrégateurs doublons.

## LOT 6 — Order 360 + Opérations

Ensemble. Order 360 = **agrégation des 3 endpoints existants** (fiche d'investigation). Operations = vue agrégée. Puis workspaces Hub/Relais, Inventory, Expéditions, Douane.

## LOT 7 — Finance

Lecture canonique **Économie ‖ Trésorerie** ; consolider Economic, Costing, Accounting, Invoices, Projection.

## LOT 8 — Pricing Workspace

La vérité économique ayant déjà été assainie en 1B, le LOT 8 est **essentiellement une consolidation de surface** (construction, composants, risques, stratégie, carte, simulation, historique) — **pas** une 2ᵉ migration du modèle économique.

## LOT 9 — Action Center

`Problems → règles manquantes migrées → Signals → Action Center`. Suppression **uniquement après parité**. Vérifier d'abord si la logique JS de ProblemsView diverge de signals (I-7).

## LOT 10 — Sécurité légère / Passkey

Compléter Client360/Auth + bande sécurité Pilotage avec le modèle OTP/Passkey/session. Pas de gros Dashboard Security tant qu'aucun besoin réel.

## LOT 11 — Purge legacy (dernier, preuve de remplacement obligatoire)

`admin-legacy`, routes obsolètes, agrégateurs doublons, fallback `pricing_components` (⚠️ **seulement après** `cost_components` prouvé complet en LOT 8, sinon CDR à zéro composant), tables mortes, vues absorbées, services orphelins.

---

# PARTIE V — DÉCISIONS HUMAINES RÉSIDUELLES

**Deux décisions ont été tranchées (sur le code) et figées dans I-5 et II-5b :**
- ✅ **Frontière Finance** : Dashboard = lecture/comprendre, Workspace = exécution des actes de clôture — cf. II-5b.
- ✅ **Fret = DEDICATED au moteur `transport-rails`**, règle W/M unifiée par rail, **option (b)** : le moteur porte un taux de **coût** et un taux de **prix commercial** distincts ; le CDR consomme **uniquement le coût** ; jamais de mélange marge/coût transport — cf. I-5. **Dernier fork bloquant de LOT 1B fermé.**

**Les décisions suivantes ne bloquent PAS le gel de la doctrine ; elles se tranchent en LOT 0 :**

1. **ProblemsView : absorption pure ou correction de vérité ?** — dépend de si sa détection JS diverge de `signals`. À vérifier en 0A ; si divergence, ses règles passent par le protocole correction-de-vérité (I-7).
2. **Contrats à figer en 0C-ui : lesquels d'abord ?** — les 59 sont trop pour un seul lot ; prioriser ceux des surfaces KEEP/MERGE des dashboards Pilotage/Finance (les plus destructrices en aval).
3. **HubRelaisView** — valider l'inventaire de sa richesse fonctionnelle avant fusion (vue la plus dense).

---

# PARTIE VI — SÉCURITÉ : PASSKEY & DÉLÉGATION

> Chapitre ajouté après le gel de la doctrine des surfaces/économie. **Passkey** = documenté sur le code réel (AUTH-2 livré). **Délégation** = doctrine proposée : la primitive admin n'existe pas encore (greenfield) ; seule la délégation client (paniers partagés / wallet) existe de fait.

## VI-1. État réel (ancré sur le code)

| Brique | État | Preuve |
|---|---|---|
| Passkey WebAuthn | ✅ livré (AUTH-2) | `routes/auth-passkey.js` monté sur `/api/auth/passkey` (`bootstrap/api-routes.js:156`) ; endpoints : `/credentials` (list), `/credentials/:id` (delete), `/register/{options,verify}`, `/login/{options,verify}`, `/step-up/{options,verify}` |
| Step-up | ✅ réel, par **fraîcheur** | `middleware/require-recent-auth.js` : preuve fraîche `< 5 min` (défaut, `AUTH_STEP_UP_MAX_AGE_SEC`), skew 30 s, renvoie **428 step_up_required**. Doctrine `auth7_step_up_by_freshness_and_method` |
| Rôles | ⚠️ **scalaire plat** | `middleware/auth.js` : `req.user.role`, `requireRole([...])`, `requireAdmin = requireRole(['admin'])`. Un seul rôle par utilisateur, aucun grant scopé |
| Niveaux K0–K3 | ⚠️ doctrine, pas encore un construct | seule trace : commentaire « K1 minimum » dans `auth-passkey.js`. Les niveaux réels aujourd'hui sont implicites : *non-authentifié* / *session valide* (`authenticate`) / *preuve fraîche* (`requireRecentAuth`) |
| Délégation **admin** | ❌ inexistante (greenfield) | aucune primitive impersonation / on-behalf / grant scopé |
| Délégation **client** | ~ partielle, de fait | `routes/shared-cart.js` (paniers partagés), contributions wallet — délégation de dépense entre clients |

## VI-2. L'échelle de confiance K0–K3 (rendue explicite)

Aujourd'hui implicite ; à matérialiser comme un **niveau porté par la session/preuve**, pas par le rôle.

| Niveau | Signification | Mécanisme réel qui l'établit | Ce qu'il autorise |
|---|---|---|---|
| **K0** | anonyme | aucune session | lecture publique boutique |
| **K1** | authentifié (session valide) | `authenticate` (cookie session, `__Host-` en prod) | actes courants du compte |
| **K2** | preuve fraîche récente | `requireRecentAuth` (< 5 min) | actes sensibles : gérer les passkeys, changer un moyen de paiement, créer/étendre une délégation |
| **K3** | preuve forte + méthode passkey | step-up **par passkey** (pas OTP) | actes critiques : révocation de credentials, délégation admin, opérations monétaires à seuil |

> Règle : le niveau requis est une **POLICY par acte** (nature D, I-4), éditée dans le domaine sécurité, jamais dans un « dépotoir » Settings.

## VI-3. Doctrine passkey (nominale) / OTP (bootstrap & recovery)

- **Passkey = authentification nominale.** Une fois enrôlé, l'utilisateur se connecte et fait son step-up **par passkey**.
- **OTP = amorçage et recovery uniquement.** L'OTP sert à créer la première preuve (K1 initial) et à récupérer un accès perdu — **jamais** comme méthode nominale ni comme step-up fort (K3).
- **Enrôlement** protégé par `requireRecentAuth` (on ne pose une passkey qu'en K2).
- **Révocation** d'une credential = acte K2 minimum (aujourd'hui `requireRecentAuth` sur `DELETE /credentials/:id`) → à élever en K3 (passkey) pour la révocation de la dernière credential.
- **Invariants WebAuthn** (les 10 couverts par les 31 tests AUTH-2) restent la référence : challenge unique, origine/RP vérifiées, compteur anti-clonage, user-verification, etc. — non renégociables.

## VI-4. Délégation (doctrine proposée — greenfield)

**Définition.** Une délégation est un **grant scopé, à durée limitée, révocable et audité**, par lequel un **délégant** confère à un **délégataire** le droit d'agir dans un périmètre précis, à un niveau de confiance donné. Ce n'est **pas** un partage de credential ni une impersonation opaque.

**Deux familles, un seul modèle :**
- **Délégation client** (partiellement existante) : partage de panier, contribution wallet, listes partagées → facette de **Client 360**.
- **Délégation admin / staff** (greenfield) : un admin confère un sous-ensemble scopé de ses droits à un opérateur → surface **workspace sécurité/config** + facette Client 360.

**Attributs canoniques** (mêmes exigences que le modèle de variables I-4b) :

`DELEGATOR` (qui donne) · `DELEGATEE` (qui reçoit) · `SCOPE` (quelles actions/quel domaine) · `LEVEL` (K requis pour agir) · `GRANTED_VIA` (preuve — step-up passkey obligatoire au-dessus d'un seuil) · `EXPIRES_AT` (durée max, jamais illimité) · `REVOCABLE_BY` (délégant + admin) · `AUDIT` (chaque acte délégué tracé, attribué au délégataire *on behalf of* le délégant).

**Invariants :**
1. **Aucun grant implicite** — toute délégation est explicite, nommée, datée (écho de la doctrine transport « aucun rail implicite »).
2. **Non-élévation** — une délégation ne confère jamais plus que ce que le délégant possède (`LEVEL délégué ≤ LEVEL délégant`).
3. **Step-up pour créer/étendre** — créer ou élargir un grant sensible exige K2/K3 du délégant.
4. **Révocation immédiate et propagée** — révoquer coupe les sessions/actes en cours du délégataire sur ce scope.
5. **Attribution, pas substitution** — l'acte délégué reste attribué au délégataire agissant pour le compte du délégant ; jamais d'identité usurpée en silence.
6. **Expiration obligatoire** — pas de délégation perpétuelle ; renouvellement explicite.

**Modèle de données proposé** (à valider) : table `delegations(id, delegator_id, delegatee_id, scope, level, granted_at, granted_via, expires_at, revoked_at, revoked_by)` + journal d'audit des actes délégués. La valeur d'un acte délégué reste dans sa source canonique — la table `delegations` ne stocke que le **droit**, pas les données de l'acte (écho I-4c « le catalogue ne stocke aucune valeur »).

**Intégration Admin :**
- La délégation est une **Business Variable** (nature D) : levier éditable, avec owner = domaine sécurité.
- Elle **s'affiche** dans **Client 360 / Authentification & Sécurité** (qui a délégué quoi, à qui, jusqu'à quand).
- Elle **s'édite** dans le workspace sécurité/config — **pas** dans un Settings fourre-tout (II-4).

## VI-5. Décisions humaines résiduelles (délégation)

Ces points relèvent de ton arbitrage métier, pas du code :

1. **Périmètre des scopes délégables** — quels rôles/actions admin peuvent être délégués, et lesquels sont non-délégables par nature (ex. révocation de sécurité, opérations monétaires au-dessus d'un seuil).
2. **Client vs admin : un modèle ou deux surfaces ?** — même table `delegations` et mêmes invariants, mais matérialisation différente (Client 360 pour le client, workspace sécurité pour le staff). À confirmer.
3. **Durées & renouvellement** — durée max par famille de scope, politique de renouvellement, révocation en cascade (si le délégant perd son niveau, ses délégations tombent-elles ?).
4. **Seuil de step-up** — à partir de quel scope la création d'une délégation exige K3 (passkey) et non K2.

---

# PARTIE VII — LE GABARIT DASHBOARD (LE MOULE)

> Un seul dashboard canonique est spécifié. Les quatre (Pilotage, Commerce, Opérations, Finance) ne sont plus des designs bespoke : ce sont des **remplissages** de ce gabarit. Le gabarit est la **spec** que LOT 2 rend réelle (`OverviewShell` + primitives) et que LOT 4 instancie en premier. Écrire la spec ici ne viole pas le STOP avant LOT 2 : c'est du design, pas du code UI.

## VII-1. Pourquoi un gabarit

Le gabarit n'est pas un layout : c'est **l'anatomie contrainte qui force la doctrine à être respectée par construction**. Un dashboard mal conçu (recompute JS, action d'exécution, alerte maison) devient **impossible à exprimer** dans le gabarit, au lieu d'être seulement « déconseillé ». Il transforme les principes I-2 / I-6 / I-3 en garde-fous structurels.

## VII-2. Les cinq zones (ordre fixe, haut → bas)

| # | Zone (primitive I-9) | Répond à | Règle |
|---|---|---|---|
| 1 | **FilterBar** | quel périmètre ? (période, canal, catégorie) | filtre **partagé**, jamais recalculé par la vue |
| 2 | **MetricStrip** | la question globale, en 4–6 chiffres | chaque métrique = un **MEASURE / DERIVED / OBJECTIVE** d'un agrégateur nommé, avec sa trajectoire (Δ vs objectif/période) |
| 3 | **AlertPanel** | qu'est-ce qui exige une action ? | alimenté par le moteur **`signals` uniquement** (II-5), jamais une détection locale ; chaque alerte porte un drill-down |
| 4 | **Corps corrélé** (2–4 InfoCard / DataTable / Timeline) | pourquoi ? | les corrélations qui expliquent le signal ; consomme des agrégateurs |
| 5 | **DrillBar** | où agir ? | liens de descente vers Workspaces / Entity 360 / Action Center — le dashboard **oriente**, il n'exécute pas |

## VII-3. Le contrat de données par zone (le cœur du gabarit)

Chaque slot **déclare** obligatoirement, en donnée, ce qu'il montre :

```
slot = {
  primitive:         MetricStrip | AlertPanel | InfoCard | DataTable | Timeline,
  source_aggregator: <endpoint/agrégateur canonique>,   // OBLIGATOIRE
  nature:            MEASURE | DERIVED | OBJECTIVE | POLICY,
  drill_to:          <workspace | entity360 | action-center | null>,
}
```

**Interdits structurels** (un slot qui les enfreint ne compile pas dans le gabarit) :
- slot **sans `source_aggregator`** → ce serait un recompute JS (viole I-6) ;
- slot qui **écrit** → c'est un workspace, pas un dashboard (viole I-2) ;
- slot qui **recalcule** une vérité économique au lieu de la consommer (viole I-6/I-19) ;
- métrique **sans `nature`** → intraçable au catalogue de variables (viole I-4).

## VII-4. Invariants du gabarit

1. **Nature A pure** — observation/lecture, zéro action d'exécution.
2. **Zéro recompute** — toute valeur vient d'un agrégateur ; aucune arithmétique métier en JS.
3. **Alertes = `signals`** — pas de détecteur maison (le péché `ProblemsView`).
4. **Chiffre tracé** — chaque valeur porte sa `nature` + sa `source_aggregator`.
5. **Tout mène quelque part** — chaque métrique/alerte a un `drill_to` ; sinon elle n'oriente pas, donc elle ne mérite pas sa place (I-3).
6. **Rempli, jamais réécrit** — un nouveau dashboard = une **config de slots**, pas un nouveau shell.

## VII-5. Comment les quatre dashboards remplissent le moule

| Dashboard | MetricStrip (exemples) | Source AlertPanel | Corps corrélé | DrillBar → |
|---|---|---|---|---|
| **Pilotage** | activité, CA, cash, marge, incidents | `signals` (top critiques) | trajectoire vs objectifs, principaux écarts | Commerce · Ops · Finance · Action Center · Entity 360 |
| **Commerce** | ventes, conversion, panier, récurrence | `signals` (commerce) | offre ↔ client (mix catégories, cohortes) | Catalogue WS · Client 360 · Product 360 |
| **Opérations** | volumes, bloquées, retards, SLA | `signals` (ops) | pipeline commande→relais, exceptions | Workspaces Ops · Order 360 |
| **Finance** | marge, CDR, rentabilité ‖ à encaisser, impayés | `signals` (finance) | Économie ‖ Trésorerie (II-1, II-5b) | Finance/Compta WS · Pricing WS |

Un seul moule, quatre configurations. Aucun shell dupliqué.

## VII-6. Héritage gratuit du Golden CDR

Les slots économiques (marge, CDR, rentabilité) déclarent `source_aggregator = <agrégateur CDR>` — celui que le **Golden CDR** (LOT 0C-eco) protège désormais. Conséquence : **un dashboard ne peut pas afficher une marge fausse**, puisqu'il consomme l'agrégateur au lieu de recomputer, et que l'agrégateur est sous filet de parité. Le gabarit hérite de la garantie sans effort — c'est exactement l'articulation `SOURCE → MOTEUR → AGRÉGATEUR → DASHBOARD` (I-6) rendue obligatoire.

## VII-7. Insertion dans les lots

- **Maintenant (LOT 0 / doctrine)** : la **spec** ci-dessus est le livrable. Elle ne touche aucun code UI.
- **LOT 2** : `OverviewShell` + primitives = le gabarit **rendu réel**. Le contrat de slot (VII-3) devient une structure de données validée.
- **LOT 4** : **Pilotage** est le **premier remplissage** — la référence vivante. Commerce / Opérations / Finance (LOT 5–7) le copient en changeant la config de slots, pas le shell.
- Garde-fou : aucun dashboard n'est construit hors gabarit ; toute dérogation doit d'abord modifier le gabarit (donc être arbitrée une fois pour toutes).
