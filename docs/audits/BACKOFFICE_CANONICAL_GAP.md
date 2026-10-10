# Backoffice Komerce — GAP canonique (menu · dashboards · Live · navigation · design)

_Audit du 2026-10-10, sur `main` après les PR #2372 à #2376. Opus a audité et arbitré ; Sonnet implémente les lots après validation du GAP. Aucune modification de code dans cet audit._

Le nom de fichier ne porte pas la date demandée (`…_2026-10-10.md`) : `gate:docs-lint` (`scripts/docs-history-lint.js:111`) refuse les dates dans les noms de fichiers sous `docs/`.

**Légende des preuves :**
- **PROUVÉ** : le code ou un rendu a été lu.
- **PROBABLE** : déduit, non exécuté.
- **NON VÉRIFIÉ** : à confirmer.

**Rendus :** banc Playwright local avec données vides, desktop 1280, 1440 et 1672 px, rôle admin. La production n'a pas été rendue (session requise).

---

## 1. Executive verdict

Le shell est désormais cohérent : un seul en-tête, un seul cadre, recherche et marché dans le Hero sur 20 surfaces sur 23. Mais le Backoffice n'est **pas encore le plus simple possible**, pour quatre raisons :

1. **Les chiffres ne sont pas une seule vérité.** « Commandes actives », « Paiements en attente » et « retards » ont 2 à 4 définitions selon l'écran. Une de ces définitions (`dashboard-orders.js:24`) contredit la machine d'états.
2. **Le menu promet des écrans que le serveur refuse.** Seule l'entrée Clients tient compte des capabilities déléguées. L'Action Center est affiché à trois rôles agents que l'API rejette.
3. **Deux paires d'écrans font doublon :**
   - Commandes (`/admin/orders`) et Opérations ;
   - Hub & Relais workspace et Hub live / Relais live, qui comptent différemment.
4. **Plusieurs parcours perdent leur contexte :**
   - le retour depuis une commande ouverte par l'Action Center, le Pilotage ou les Opérations ramène toujours au Commerce ;
   - « Résolu » dans l'Action Center n'exige aucune preuve ;
   - la gestion des marchés (`/api/admin/markets`) n'a plus aucune interface atteignable.

**Cible :**
- 5 dashboards de décision au lieu de 6, plus les 3 cockpits Live inchangés ;
- 20 entrées de menu admin au lieu de 22, plus un doublon « Paramètres » retiré ;
- 7 renommages.

**Plan :** 6 lots P0/P1 suffisent pour un Backoffice honnête (vérité, menu, parcours, Live). 4 lots P2 consolident ensuite le Legacy, les Marchés et le CSS.

---

## 2. Inventaire de l'existant

### 2.1 Menu réel par rôle (PROUVÉ)

Le menu a été extrait en exécutant `sidebarGroupsFor()` de `public/dashboards/canonical/js/navigation-policy-v4.js:753-901`.

| Groupe | Entrée | Route | Rôles | Capability déclarée |
|---|---|---|---|---|
| Piloter | Tour de contrôle | `/admin/pilotage` | admin, market_operator | — |
| | Action Center | `/admin/action-center` | admin, market_operator, agent_hub, agent_relais, agent_transitaire | — |
| Flux | Commerce | `/admin/commerce` | admin, market_operator | — |
| | Commandes & logistique | `/admin/operations` | admin, market_operator | — |
| | Finance | `/admin/finance` | admin, market_operator | — |
| Live | Sourcing live | `/admin/import-runtime` | admin, sourcing | — |
| | Hub live | `/admin/hub-live` | admin, agent_hub | — |
| | Relais live | `/admin/relais-live` | admin, agent_relais | — |
| Entités | Commandes | `/admin/orders` | admin, market_operator | — |
| | Produits | `/admin/workspaces/catalog?view=advanced` | admin | — |
| | Clients | `/admin/clients` | admin, market_operator | `client.read` |
| Workspaces | Atelier économique | `/admin/workspaces/pricing` | admin, market_operator | — |
| | Catalogue | `/admin/workspaces/catalog` | admin | — |
| | Sourcing | `/admin/workspaces/sourcing` | admin, sourcing | — |
| | Achats fournisseurs | `/admin/workspaces/purchasing` | admin | — |
| | Hub & Relais | `/admin/workspaces/operations` | admin, agent_hub, agent_relais, market_operator | — |
| | Expéditions & Douane | `/admin/workspaces/shipping-customs` | admin, agent_hub, agent_transitaire, market_operator | — |
| | Finance / Comptabilité | `/admin/workspaces/accounting` | admin, finance, agent_relais, market_operator | — |
| Marchés | Marchés | `/dashboards/canonical/access.html` | admin | — |
| | Autonomie marché | `/dashboards/canonical/market-autonomy.html` | market_operator | — |
| | Catalogue pays | `/dashboards/canonical/market-catalog.html` | market_operator | — |
| Administration | Utilisateurs | `/admin/users` | admin | — |
| | Providers | `/admin/providers` | admin | — |
| | Paramètres | `/admin/settings` | admin | — (lien répété en pied de menu, `:158`, `:629-638`) |

**Volume par rôle :**
- admin : 22 entrées.
- market_operator : 13 entrées, **identiques avec ou sans capabilities déléguées**, à l'exception de Clients.
- finance : 1 entrée.
- sourcing : 2 entrées.
- agent_hub : 4 entrées.
- agent_relais : 4 entrées.
- agent_transitaire : 2 entrées.
- support : 0 entrée (accueil `/portail`).

### 2.2 Routes HTML (PROUVÉ, `bootstrap/html-routes.js`)

- **SPA canonique (`:105-162`, `:312-336`) :** les 23 chemins `/admin/*` des surfaces ci-dessus, plus `/admin/demo` et les fiches 360 (`/admin/orders/:ref`, `/admin/clients/:phone`, `/admin/products/:ref`, `/admin/suppliers/:id`).
- **Legacy 1 obligatoire (`:306-319`) :** `/admin/customs`, `/admin/suppliers`, `/admin/sales`, `/admin/transitaire`, `/admin/sante`, `/admin/shared-carts`, `/admin/simulator`. Ces écrans ne sont atteints que par `/portail` (`public/dashboards/admin/portal-pilotage.js`).
- **Rollback `?legacy=1` encore ouvert :** pilotage, clients, pricing ×4, action-center, opérations, finance, 4 redirections historiques, settings.
- **Catch-all `:381` :** tout chemin non déclaré sert la **boutique**. C'est le cas de `/admin/markets` et de `/admin/costing/recalibration`.
- **Applis terrain :** `/hub` et `/relais` (écriture terrain) ; `/portail` et `/pilotage` (lanceur Legacy).

### 2.3 Dashboards et sources (PROUVÉ)

| Écran | Endpoint (global / marché) | Service propriétaire | Capability marché |
|---|---|---|---|
| Pilotage | `/api/admin/dashboard/unified` · `/unified/market/:code` | `dashboard-pilotage-market.js`, `dashboard-metrics/*` | `dashboard.market.read` |
| Commerce | `/commerce` · `/commerce/market/:code` | `dashboard-commerce.js` | `dashboard.market.read` |
| Commandes | `/orders` · `/orders/market/:code` | `dashboard-orders.js` | `dashboard.market.read` |
| Opérations | `/operations` · `/operations/market/:code` | `dashboard-operations.js`, `dashboard-metrics/logistics.js` | `operations.read` |
| Finance | `/finance` · `/finance/market/:code` | `dashboard-finance-canonical.js` | `finance.read` |
| Action Center | `/api/admin/action-center` · `/market/:code` | `action-center-workspace.js`, `signal-admin-service.js` | lecture `dashboard.market.read`, actions `decision_signal.manage` |
| Sourcing live | `/api/admin/workspaces/sourcing/import-cockpit`, `/import-passages`, `/import-runs/*` | `import-runtime-runs`, `import-lot-registry` | rôle `sourcing`, global |
| Hub live | `/api/hub-dash/dashboard`, `/queue`, `/orders/:id` | `hub-dashboard-queries.js` | `operations.read` (market_operator) |
| Relais live | `/api/relay/dashboard`, `/orders`, `/orders/:id` | `relay-dashboard-queries.js` | `operations.read`, ou `relais_id` (agent_relais) |
| Hub & Relais (workspace) | `/api/admin/workspaces/operations/market/:code` | `operations-workspace.js` | `operations.read` |

Les routes Pilotage, Commerce, Commandes, Opérations et Finance sont toutes servies sous `/api/admin/dashboard/` par `routes/admin-dashboard-market.js`, et pour le Pilotage global par `routes/admin-dashboard.js:288`.

---

## 3. Matrice d'arbitrage

### 3.1 Menu

| Entrée actuelle | Décision | Cible | Justification (constat) |
|---|---|---|---|
| Tour de contrôle | CONSERVER | Piloter › Tour de contrôle | point d'entrée transverse |
| Action Center | RENOMMER, RESTREINDRE | Piloter › À traiter (admin, market_operator) | le Hero dit déjà « Décisions à traiter » ; l'API refuse les agents (NAV-02) |
| Commerce | DÉPLACER, RENOMMER | Commerce › Vue d'ensemble | regroupement par domaine (D1) |
| Commandes & logistique | RENOMMER, DÉPLACER | Opérations › Vue d'ensemble | son titre affiche « Opérations — Tour de contrôle », un second « Tour de contrôle » (NAV-05) |
| Finance | DÉPLACER | Finance › Vue d'ensemble | idem |
| Sourcing live, Hub live, Relais live | CONSERVER | Live › (inchangé) | décision utilisateur : domaine Live séparé, écrans laissés en l'état |
| Commandes (Entités) | FUSIONNER | dans Opérations › Vue d'ensemble | dashboard en doublon (DASH-05) ; Order 360 reste atteint par la recherche et les liens |
| Produits | FUSIONNER | onglet local « Produits » du Catalogue (déjà dans `LOCAL_TABS.catalog`) | même surface, même Hero (rendu PROUVÉ) |
| Clients | DÉPLACER | Commerce › Clients | entité commerciale |
| Atelier économique | RENOMMER, DÉPLACER | Commerce › Prix & économie | le Hero dit « Prix & économie » |
| Catalogue | DÉPLACER | Commerce › Catalogue | — |
| Sourcing | DÉPLACER | Opérations › Sourcing | — |
| Achats fournisseurs | DÉPLACER | Opérations › Achats fournisseurs | — |
| Hub & Relais | DÉPLACER | Opérations › Hub & Relais | — |
| Expéditions & Douane | DÉPLACER | Opérations › Expéditions & Douane | — |
| Finance / Comptabilité | RENOMMER, DÉPLACER | Finance › Comptabilité | — |
| Marchés (`access.html`) | RENOMMER | Marchés › Responsables pays | le libellé « Marchés » laisse croire à une gestion des marchés absente (NAV-08) |
| Autonomie marché, Catalogue pays | CONSERVER | Mon marché › … (market_operator) | responsabilité propre au marché, séparée de la plateforme |
| Utilisateurs, Providers | CONSERVER | Administration | — |
| Paramètres (×2) | SUPPRIMER le doublon de pied de menu | Administration › Paramètres | NAV-03 |

### 3.2 Dashboards

| Dashboard | Décision | Motif |
|---|---|---|
| Pilotage | CONSERVER, CORRIGER | le compte d'alertes ne correspond pas à la liste de l'Action Center (DASH-04) |
| Action Center | CONSERVER, CORRIGER | « Résolu » sans preuve (DASH-09) ; liens entrants à ajouter depuis les autres écrans (DASH-10) |
| Commerce | CONSERVER | funnel de référence |
| Commandes `/admin/orders` | CONSOLIDER dans Opérations | ses files « Cash à confirmer » et « Colis à créer » recoupent Opérations ; son funnel recoupe Commerce ; une partie de ce qu'il calcule n'est pas affichée (DASH-05) |
| Opérations | CONSERVER, ABSORBER les files Commandes | — |
| Finance | CONSERVER | — |
| Hub live, Relais live | CONSERVER (lecture seule), CORRIGER le Live | LIVE-01 à LIVE-07 |
| Sourcing live | CONSERVER, CORRIGER le Live | LIVE-01, LIVE-02 |
| Hub & Relais workspace | CONSERVER (actions), ALIGNER les comptages sur une projection | LIVE-06 (D4) |

---

## 4. Arborescence canonique cible

```
PILOTER                      admin · market_operator
  Tour de contrôle           /admin/pilotage
  À traiter                  /admin/action-center      (agents : quand B-AC-agents livré)
COMMERCE
  Vue d'ensemble             /admin/commerce            cap dashboard.market.read
  Catalogue                  /admin/workspaces/catalog  admin · onglets : Vue catalogue | Produits
  Prix & économie            /admin/workspaces/pricing
  Clients                    /admin/clients             cap client.read
OPÉRATIONS
  Vue d'ensemble             /admin/operations          cap operations.read (+ files Cash / Colis)
  Sourcing                   /admin/workspaces/sourcing         admin · sourcing
  Achats fournisseurs        /admin/workspaces/purchasing       admin
  Hub & Relais               /admin/workspaces/operations       cap operations.read
  Expéditions & Douane       /admin/workspaces/shipping-customs cap operations.read
FINANCE
  Vue d'ensemble             /admin/finance             cap finance.read
  Comptabilité               /admin/workspaces/accounting cap finance.read
LIVE                         (inchangé, coque noire)
  Sourcing live · Hub live · Relais live
MARCHÉS                      admin (plateforme)
  Responsables pays          /dashboards/canonical/access.html
  [Créer / gérer les marchés — D5, chantier « Market deployment package »]
MON MARCHÉ                   market_operator (responsabilité du marché)
  Autonomie marché · Catalogue pays
ADMINISTRATION               admin
  Utilisateurs · Providers · Paramètres
```

**Nombre d'entrées :**

| Rôle | Aujourd'hui | Cible |
|---|---|---|
| admin | 22 | 20 |
| market_operator | 13 | 12, puis selon ses capabilities |
| agents | — | perdent « Action Center » tant que l'API les refuse |

Pour l'admin, deux entrées sont fusionnées (Produits, Commandes) et le doublon de pied de menu « Paramètres » est retiré. Pour le market_operator, l'entrée Commandes est fusionnée.

**Doctrine :** le regroupement par domaine (Commerce / Opérations / Finance) remplace la taxonomie technique « Flux / Entités / Workspaces » de la doctrine `ADMIN_NAVIGATION_DOCTRINE_V3`. C'est la décision **D1**. Sans D1, le lot L2 applique seulement suppressions, fusions, renommages et gating, et garde les groupes actuels.

---

## 5. Cartographie des dashboards cibles

| Dashboard | Mission unique | Propriétaire de la vérité | KPI conservés | Actions / sorties |
|---|---|---|---|---|
| Tour de contrôle | « Où faut-il décider maintenant ? » | `dashboard-pilotage-market` + `dashboard-metrics` | CA encaissé, Commandes actives (définition unique), Marge consolidée, Alertes critiques (même périmètre que À traiter), Complétude coûts | vers les 3 vues d'ensemble et À traiter, avec `returnTo` |
| À traiter | « Quels signaux exigent un humain ? » | `signals` (générateurs `signal-service.js`, cron 15 min) | Urgent, Avertissements, Infos, Actifs | Vu / Reporter / Résolu (politique D3) → objet (Order / Product 360, PO) avec `returnTo` |
| Commerce | « Vend-on, et rentablement ? » | `dashboard-commerce` | CA, Commandes créées, Panier moyen, Produits vendus, funnel (référence unique) | Catalogue, Prix, Clients, Catalogue pays |
| Opérations | « Qu'est-ce qui bloque le flux physique et le cash à confirmer ? » | `dashboard-operations` + files de `dashboard-orders` (projection existante, pas de nouvelle requête) | Paiements en attente (définition unique), Colis en préparation, en transit, disponibles, Retards (seuils libellés) | files Cash à confirmer et Colis à créer → Order 360 ; workspaces Hub & Relais, Expéditions, Achats |
| Finance | « La marge est-elle prouvée ? » | `dashboard-finance-canonical` | CA, Coût réel, Marge, Complétude coûts, Paiements en attente (même définition, bornée par la période), Remboursements | Comptabilité, Prix |
| Live ×3 | « Ça tourne ? Quelque chose m'attend ? » | services Live existants | inchangés | inchangées (lecture seule pour Hub et Relais) |

---

## 6. GAP Live et vérité métier

| ID | P | Constat | Preuve | Impact | Décision | Cx |
|---|---|---|---|---|---|---|
| DASH-01 | **P0** | « Commandes actives » sur Commandes utilise `LIFECYCLE = pending, confirmed, paid, ordered, available, collected, in_transit`. `paid` n'est pas un statut de commande ; `collected` est terminal ; `preparation` et `shipped` manquent. Le commentaire cite pourtant la machine d'états. Le Pilotage utilise `ACTIVE_ORDER_STATUSES`. | `services/dashboard-orders.js:22-24,350` · `services/order-status-machine.js:87-97` · `services/dashboard-metrics/_helpers.js:45-47` — PROUVÉ | même libellé, deux chiffres, dont un faux | une seule définition (`ACTIVE_ORDER_STATUSES`), séquence alignée sur `VALID_TRANSITIONS` | S |
| DASH-02 | P1 | « Paiements en attente » a 4 définitions : Opérations (tous), Finance (sur la période), bandeau Commandes (plus de 72 h), KPI Commandes (tous) | `dashboard-metrics/logistics.js:58` · `dashboard-finance-canonical.js:444,80` · `dashboard-orders.js:67,258` — PROUVÉ | chiffres contradictoires | une définition par défaut ; les variantes portent leur seuil dans le libellé (« … depuis plus de 72 h ») | S |
| DASH-03 | P1 | « Retard » a 4 seuils muets : 14 j (expédié), 72 h (au relais), 7 j (signal `pickup_overdue`), 3 j (`parcel_blocked`) | `logistics.js:115` · `dashboard-orders.js:224` · `signal-service.js:699` · `:442` — PROUVÉ | « en retard » n'a pas de sens stable | les seuils sont nommés et affichés ; ils sont centralisés dans `dashboard-metrics/_helpers.js` (constantes existantes, aucune nouvelle source) | S |
| DASH-04 | P1 | Le Pilotage global compte tous les signaux (`1=1`) ; l'Action Center global ne liste que `market_id IS NULL`. En vue marché, le rattachement passe par la commande d'un côté, par `signals.market_id` de l'autre. | `_helpers.js:122-125,129` · `signal-admin-service.js:84` — PROUVÉ | le chiffre cliqué ne correspond pas à la liste ouverte | le compteur du Pilotage réutilise le prédicat de `signal-admin-service` | M |
| DASH-05 | P1 | `/admin/orders` calcule `signals.sla`, `priority_orders`, `lifecycle` et `payment_mix` sans les afficher ; ses files recoupent Opérations | `orders-decision.js:121,206` · `dashboard-orders.js` — PROUVÉ | écran redondant, calculs morts | CONSOLIDER (L3) | M |
| DASH-06 | P2 | Opérations compte « Incidents critiques » et « Points d'attention » côté client sur 12 signaux au plus | `dashboard-operations.js:152` · `operations-decision.js:344-351` — PROUVÉ | plafond silencieux à 12 | le serveur renvoie les totaux | S |
| DASH-07 | P2 | 4 des 9 types de signaux d'Opérations n'ont pas de producteur (`hub_tension`, `relay_tension`, `loyalty_pending`, `sla_breach`) | `dashboard-operations.js:30+` · `signal-service.js` — PROBABLE | catégories toujours vides | retirer de la liste ou brancher (propriétaire : signaux) | S |
| DASH-08 | P2 | « Points d'attention » du Pilotage est absent en vue marché | `dashboard-pilotage-market.js:139` (5 KPI) contre `services/dashboard-metrics/control-tower.js:232` — PROUVÉ | KPI différent selon le périmètre | projeter le même champ | S |
| DASH-09 | P1 | « Résolu » dans l'Action Center fait un `UPDATE status='resolved'` avec un corps vide, sans note ni vérification de l'objet. Certains générateurs auto-résolvent (`autoResolveSignals`), donc un problème encore présent revient au cron suivant (15 min). | `signal-admin-service.js:246-258` · `action-center.js:319` · `signal-service.js:53,719` · `bootstrap/crons.js:97` — PROUVÉ, retour du signal PROBABLE | une résolution visuelle sans preuve | politique D3 (L6) | M |
| DASH-10 | P2 | Seul le Pilotage pointe vers l'Action Center | `services/dashboard-metrics/control-tower.js:192,233` · `pilotage-decision.js:199` — PROUVÉ | les signaux d'Opérations, Finance et Commerce ne mènent pas au seul endroit où l'on peut agir | lien « Traiter » vers `/admin/action-center?severity=…` (paramètre déjà lu, `action-center.js:86`) | S |
| LIVE-01 | P1 | Les écouteurs `popstate`, `focus` et `visibilitychange` sont ajoutés à chaque montage et jamais retirés | `live-kit.js:222-226` · `import-runtime.js:2556-2562` — PROUVÉ | les relectures se multiplient à chaque navigation SPA | enregistrer une seule fois, ou retirer au démontage | S |
| LIVE-02 | P1 | L'heure « mis à jour » vient de l'horloge du navigateur ; il n'y a ni état périmé ni pause quand l'onglet est masqué | `hub-live.js:216,118` · `relay-live.js:202` · `live-kit.js:177-202,229` · `import-runtime.js:21,2481-2486` — PROUVÉ | un écran figé paraît « live » | afficher le `generated_at` du serveur ; état « données de plus de 3 × l'intervalle de rafraîchissement » ; pause quand l'onglet est masqué | S |
| LIVE-03 | P1 | Une erreur SQL sur les KPI Hub renvoie 0 au lieu d'une erreur | `hub-dashboard-queries.js` ≈ `:95`, `:117` (try/catch) — PROUVÉ | faux calme (« rien à faire ») | propager l'erreur ; l'écran affiche son état d'erreur existant | S |
| LIVE-04 | P1 | Dans Relais live, « Tous les colis » exclut `in_transit` alors que la tuile l'inclut | `relay-dashboard-queries.js:146-150` contre `:67` — PROUVÉ | liste incohérente avec la tuile | inclure `in_transit` dans le filtre par défaut | S |
| LIVE-05 | P2 | Le KPI Hub « expédiées aujourd'hui » repose sur `orders.updated_at` | `hub-dashboard-queries.js:46` — PROUVÉ | compte toute mise à jour d'une commande expédiée | utiliser la date de transition (historique de statut) | S |
| LIVE-06 | P1 | Deux vérités pour Hub et Relais : les services Live et `operations-workspace.js` calculent séparément ; « Disponibles au relais » compte des `parcels` côté Hub et des `orders` côté Relais | `hub-dashboard-queries.js:85` · `relay-dashboard-queries.js` · `services/operations-workspace.js` — PROUVÉ (chiffres non comparés ligne à ligne) | un même état, deux nombres | D4 : une projection propriétaire ; l'autre la consomme | M |
| LIVE-07 | P1 | Les API Live renvoient `client_phone`, `client_email`, `relais_phone` (et le code de retrait masqué côté Relais), non affichés, alors que la carte promet « aucune donnée de contact client exposée » | `hub-dashboard-queries.js:230-231` · `relay-dashboard-queries.js:168,205,226-227` · `features/dashboard.feature.js:375,377` — PROUVÉ | données personnelles inutiles dans la réponse réseau | retirer ces champs des projections utilisées par les écrans Live (les applis terrain qui en ont besoin passent par leurs propres routes : à vérifier, NON VÉRIFIÉ) | S |
| LIVE-08 | P2 | Le badge Hub « en retard (plus de 48 h) » est recalculé côté client alors que le serveur fournit `urgent` | `hub-live.js:74` · service `:49` — PROUVÉ | règle métier dans le navigateur | utiliser `urgent` | S |
| LIVE-09 | info | Des capacités backend n'ont aucun appelant : `hub-dash …/escalate` et `/comment`, `relay …/comment` et `/escalate`, `import-runs/replay`, `catalog-changes/observe` | rapport d'exploration — PROBABLE | capacités invisibles | aucune action : à exposer seulement sur un besoin exprimé | — |

---

## 7. GAP UX/UI

| ID | P | Constat | Preuve | Décision | Cx |
|---|---|---|---|---|---|
| UX-01 | P1 | 37 feuilles CSS ; au moins 5 couches de thème ou de coque se recouvrent (`visual-freeze-v1`, `canonical-theme-v2`, `canonical-shell-v4`, `canonical-finish-polish-v1`, `canonical-legacy-theme-v1` (970 lignes), `cockpit-legacy-v1`), et 3 se déclarent « autorité » ou « dernière couche » (`komerce-visual-canon-v1`, `komerce-layout-canon-v1`, `hero-first-shell-conformance-v1`) | `public/dashboards/canonical/index.html`, en-têtes des fichiers — PROUVÉ | UNIFIER : billet B2b déjà décidé, sans changement visuel, avec diff de captures sur 5 écrans | L |
| UX-02 | P1 | Les pages Marchés autonomes chargent 12 à 15 feuilles, aucune des feuilles canon (Hero, visual canon, layout canon), avec des versions périmées (`canonical-shell-v4?v=2101`). `access.html` empile deux titres : « Responsables pays » (`market-access.js:334`) puis le Hero « Pilotage des marchés » (`markets-decision.js:362`, inséré par `markets-decision-bootstrap.js:98-99`). | rendu 1672 px · rapport d'exploration — PROUVÉ | CORRIGER : charger les feuilles canon, un seul Hero ; montage dans la SPA plus tard (bloqueurs §9) | M |
| UX-03 | P2 | Paramètres et Démo ne sont pas au canon hero-first (ancien bandeau de recherche, pas de Hero) | rendu 1672 px — PROUVÉ | UNIFIER (classe `kmc-hero-first` + Hero) | S |
| UX-04 | P2 | Le Hero de Comptabilité contient le filtre de dates et le bouton « Appliquer », entre le titre et l'illustration | rendu — PROUVÉ | déplacer le filtre dans la première section | S |
| UX-05 | P2 | Illustrations empruntées : Opérations et Expédition partagent la même scène ; Prix utilise celle de Finance, Sourcing celle d'Opérations | `contextual-heroes-v2.css:92-108` — PROUVÉ | RÉUTILISER le mécanisme, dessins dédiés quand ils existent | M |
| UX-06 | P2 | Vocabulaire : le menu, le kicker et le titre divergent : « Commandes & logistique » / LOGISTIQUE / « Opérations — Tour de contrôle » ; « Finance / Comptabilité » / « Cash & dépôts » ; « Hub & Relais » / « Flux à traiter » | `operations-decision.js:552` · `finance-accounting-workspace.js:102` · rendu — PROUVÉ | le libellé du menu = le kicker ; le titre dit la question | S |
| UX-07 | P2 | La page Hub & Relais fait 1684 px de haut à vide (4 sections empilées) | rendu — PROUVÉ | vue exclusive par onglet (doctrine « une vue = une question ») | M |
| UX-08 | info | Recherche et marché dans le Hero : aucun chevauchement ni défilement horizontal à 1280, 1440 et 1672 px sur 8 écrans | rendu — PROUVÉ (données vides ; densité avec données réelles NON VÉRIFIÉE) | — | — |
| UX-09 | info | Mobile hors cible : le Backoffice est desktop (décision utilisateur). La coque Live (barre latérale de 220 px, élément actif bleu) est laissée en l'état (décision du 2026-10-10). | — | non traité | — |

---

## 8. GAP navigation et parcours

| ID | P | Constat | Preuve | Décision | Cx |
|---|---|---|---|---|---|
| NAV-01 | P1 | Le menu ignore les capabilities déléguées, sauf pour Clients. Un market_operator sans capability voit Commerce, Opérations, Finance, Hub & Relais, Expéditions et Comptabilité, que le serveur refuse. | `navigation-policy-v4.js:1001-1007` (seul `tab.capability` est testé) · `routes/admin-dashboard-market.js:120-124` · `admin-operations-workspace.js:137` · `admin-finance-accounting-workspace.js:42` — PROUVÉ | déclarer `capability` sur chaque entrée selon la capability serveur ; test de matrice menu ↔ serveur | S |
| NAV-02 | P1 | L'Action Center est affiché à agent_hub, agent_relais et agent_transitaire alors que toutes les routes exigent admin ou market_operator | `navigation-policy-v4.js:759` · `routes/admin-action-center.js:152,164,175,186,197` — PROUVÉ | masquer jusqu'au lot « Action Center agents » (filtrage serveur strict, déjà décidé) | S |
| NAV-03 | P2 | « Paramètres » apparaît deux fois (entrée Administration et lien de pied de menu) | `navigation-policy-v4.js:158,629-638,817` — PROUVÉ | garder l'entrée Administration | S |
| NAV-04 | P2 | « Produits » ouvre le même écran que Catalogue (`?view=advanced`) | `navigation-policy-v4.js:785` · rendu — PROUVÉ | onglet local uniquement | S |
| NAV-05 | P1 | Retour sans contexte : les liens vers Order 360 depuis l'Action Center, le Pilotage, les Opérations et le Commerce ne passent pas `returnTo` ; le retour ramène alors au Commerce (`BACK_TARGETS['order-360']`) | 0 occurrence de `returnTo` dans `action-center.js`, `operations*.js`, `pilotage*.js`, `commerce*.js` ; `navigation-policy-v4.js:162,208` ; Order 360 → Achats le fait bien (`order-360.js:188`) — PROUVÉ | utiliser `nav.withReturnTo` partout (le helper existe) | S |
| NAV-06 | P2 | Liens morts ou paramètres ignorés : `/admin/costing/recalibration` tombe sur la boutique ; `/admin/finance?cost_status=` et `?status=active` ne sont pas lus | `dashboard-pilotage-market.js:150` · `html-routes.js:381` · `pilotage-decision.js:120` · `services/dashboard-metrics/control-tower.js:142` — recalibration PROBABLE (réécriture de `pilotage.js:33` non vérifiée sur ce chemin), paramètres PROUVÉ | brancher le filtre ou retirer le paramètre ; supprimer le lien de recalibrage | S |
| NAV-07 | P1 | La gestion des marchés (`/api/admin/markets` : création, reprovisionnement, cycle de vie) n'a plus d'interface : `MarketsView` (Legacy, `admin/js/app.js:106`) est sur `/admin/markets`, qui n'est pas servi et tombe sur la boutique | `html-routes.js` (absent des listes) `:381` · aucun appel dans `canonical/` — PROUVÉ | capacité invisible ; D5, à rattacher au chantier « Créer un nouveau marché » | M |
| NAV-08 | P2 | Le routeur client traite `/admin/suppliers` comme interne alors que le serveur sert le Legacy ; dans la SPA, la page afficherait le Pilotage | `canonical-client-router-v4.js:91` · `app.js:154-193` — PROUVÉ | retirer `/admin/suppliers` de la liste | S |
| NAV-09 | P2 | La recherche globale envoie HUB_UNIT, CUSTOMS_SHIPMENT et PARCEL vers la racine d'un workspace, sans l'objet ; produits et clients ne sont pas cherchables | `services/canonical-reference-resolver.js:73-91` — PROUVÉ | lien direct vers l'objet (Order 360 en repli) ; extension à produits et clients = D-option | M |
| NAV-10 | P2 | `/portail` est la seule porte vers les 7 écrans Legacy, et n'accepte que admin, finance, sourcing, hub, relais et support (pas agent_*, market_operator ni agent_transitaire) | `portal-pilotage.js:15,294` — PROUVÉ | traiter avec L9 (retrait Legacy) | S |
| NAV-11 | P2 | L'admin ne voit pas Autonomie marché ni Catalogue pays : pas de supervision de la vue locale d'un marché | `navigation-policy-v4.js:807-808,841-843` — PROUVÉ | D9 | S |

**Parcours testés :**

| Parcours | État | Points cassés |
|---|---|---|
| Dashboard → anomalie → détail → action → preuve → retour | rompu au retour | NAV-05 |
| Action Center → objet → résolution → actualisation | résolution sans preuve, retour perdu | DASH-09, NAV-05 |
| Commande → fournisseur → achat | complet, avec `returnTo` | — |
| Commande → paiement → logistique | partiel : pas de lien vers l'expédition ou la douane de la commande | NON VÉRIFIÉ en détail |
| Recherche → référence → page de vérité | partiel | NAV-09 |
| Administration → configuration → retour | complet pour Paramètres (lecture et règles) ; écritures taxes et dimensions retirées volontairement (410) | — |
| Marché → opérations locales → finance locale | possible par le sélecteur de marché, mais le menu ne reflète pas les capabilities | NAV-01 |

---

## 9. Plan de consolidation

- **Composants partagés à rendre canoniques :**
  - Hero `[data-dashboard-role="hero"]` (`.kmc-dashboard-header` ou `.kmc-workspace-header`) avec la classe `kmc-hero-first` (`HERO_FIRST_SURFACES`) ;
  - kicker champagne ;
  - cartes KPI `.kmc-metric-card` (scope `komerce-visual-canon-v1.css`) ;
  - `ui.Section` et `ui.UIState` (chargement, vide, erreur) ;
  - `nav.withReturnTo` ;
  - `live-kit.js` comme moteur unique de rafraîchissement : `import-runtime.js` duplique son polling et sa gestion d'erreur, et doit à terme le consommer.
- **Définitions métier uniques :** `ACTIVE_ORDER_STATUSES` et les seuils de retard dans `services/dashboard-metrics/_helpers.js`. Ce sont des définitions existantes, pas une nouvelle vérité. Le prédicat de périmètre des signaux reste dans `signal-admin-service`.
- **Suppressions sûres (consommateurs vérifiés) :**
  - SettingsView Legacy et le rollback `/admin/settings?legacy=1` : `settings-workspace.js` est natif et complet (`app.js:698-708`) ;
  - l'entrée `/admin/suppliers` du routeur client ;
  - le doublon « Paramètres » ;
  - l'entrée de menu « Produits » ;
  - le dashboard `/admin/orders`, après absorption, en conservant la route en redirection vers `/admin/operations`.
- **Retraits conditionnels :**

| Élément | Condition avant retrait |
|---|---|
| `admin-legacy/` | migrer d'abord le retrait exceptionnel avec code (`ct-views-pickup-secret.js`, `/api/pickup/{pay-cash,verify,collect}`, seul consommateur) ; noter qu'il est aujourd'hui servi en statique sans le flag `ADMIN_LEGACY_ENABLED` (`server.js:158`) |
| Customs | migrer les taux effectifs vers Expéditions & Douane |
| Transitaire | migrer l'envoi en lot et l'historique vers Expéditions & Douane |
| Sales | décision D6 (cohortes, îles, paiements vers Commerce, ou abandon) |
| Santé | décision D6 |
| Suppliers (CRUD partenaires multi-familles) | décision D6 : qui gère les partenaires ? |

- **À conserver :**
  - SharedCarts : support, sans équivalent ;
  - Simulator : outil de staging, bloqué en production (`routes/simulator.js:32`) ;
  - applis terrain `/hub` et `/relais` : seules surfaces d'écriture terrain complètes.
- **Bloqueurs pour monter les pages Marchés dans la SPA (PROUVÉ) :**
  - `market-access.js:495` écrase `KomerceCanonicalAdmin` ;
  - `:454,509` démarrent tout seuls dans `#canonical-admin-root` ;
  - `markets-decision-bootstrap.js:174-181` aiguille selon `location.pathname` ;
  - `market-autonomy.js:22` et `market-catalog.js:21` ne démarrent qu'une fois, au chargement ;
  - aucune route serveur `/admin/access` ni `/admin/markets`.
- **Divergences documentaires à corriger dans la PR concernée :**
  - `features/dashboard.feature.js:343` (« /admin/* restent sur Legacy 1 jusqu'au cutover ») est contredit par `html-routes.js` ;
  - le commentaire de `html-routes.js:322` (« SettingsView portée telle quelle ») est périmé ;
  - la promesse « aucune donnée de contact » des lignes `:375` et `:377` est contredite par LIVE-07.

---

## 10. Backlog Sonnet

Les lots sont ordonnés par dépendance. Chaque lot = 1 PR. Pour chaque lot : `agent:context --pack <type>`, `arch:impact`, puis `pr:preflight` vert avant push.

### L1 — Une seule vérité des KPI commandes · P0/P1 · S
- **Objectif :** DASH-01, DASH-02, DASH-03 (+ DASH-08).
- **Périmètre :** `services/dashboard-orders.js` (`LIFECYCLE`, actifs, paiements), `services/dashboard-metrics/_helpers.js` (constantes de seuil), `logistics.js`, `dashboard-finance-canonical.js`, libellés dans `orders-decision.js`, `operations.js` et `finance.js`.
- **Modifications :**
  - `LIFECYCLE` réaligné sur `VALID_TRANSITIONS` (sans `paid`) ;
  - « actives » = `ACTIVE_ORDER_STATUSES` ;
  - les seuils deviennent des constantes nommées, affichées dans les libellés ;
  - « Points d'attention » projeté en vue marché.
- **À préserver :** les contrats d'API (ajout de champs autorisé, pas de retrait), le cache `dashboard-cache.js` et les scopes marché.
- **Dépendances :** aucune.
- **Tests :**
  - unitaires `dashboard-orders`, `dashboard-metrics`, `dashboard-finance-canonical` ;
  - nouveau test qui vérifie que tout ensemble « actif » est inclus dans les statuts de la machine d'états ;
  - e2e `dashboard-role-matrix`.
- **Critère d'acceptation :** sur une même fixture, « Commandes actives » est identique sur Pilotage et Commandes, et aucun statut hors machine n'est utilisé.
- **Rollback :** revert de la PR (aucune migration).

### L2 — Menu honnête · P1 · S
- **Objectif :** NAV-01, NAV-02, NAV-03, NAV-04, NAV-08, plus les renommages qui ne dépendent pas de D1 (À traiter, Prix & économie, Comptabilité, Responsables pays, et le titre d'Opérations sans « Tour de contrôle »).
- **Périmètre :** `navigation-policy-v4.js` (déclaration de `capability` par entrée), `canonical-client-router-v4.js:91`, `operations-decision.js:552`.
- **À préserver :**
  - `SURFACE_TO_DOMAIN` et le garde de landing ;
  - les accueils par rôle ;
  - l'onglet local Produits.
- **Dépendances :** aucune. Le regroupement par domaine fait l'objet de L2b, après D1.
- **Tests :**
  - `canonical-navigation-policy-v3`, `navigation-policy-v4`, `canonical-navigation-policy-v4-capability-gate`, `canonical-hybrid-shell-v4` ;
  - e2e `admin-menu-navigation` et `dashboard-role-matrix` ;
  - nouveau test de matrice « entrée visible ⇒ capability serveur requise accordée ».
- **Critère d'acceptation :**
  - un market_operator sans `finance.read` ne voit ni Finance ni Comptabilité ;
  - les agents ne voient pas À traiter ;
  - un seul lien Paramètres.
- **Rollback :** revert.

### L3 — Consolidation Commandes → Opérations · P1 · M
- **Objectif :** DASH-05.
- **Périmètre :**
  - `operations.js` et `operations-decision.js` affichent les files « Cash à confirmer » et « Colis à créer » ;
  - la donnée vient de la projection existante de `dashboard-orders` (appel de l'endpoint `/orders` existant, ou exposition par le service Opérations en réutilisant les fonctions de `dashboard-orders` ; aucune requête SQL dupliquée) ;
  - `/admin/orders` redirige vers `/admin/operations` (`html-routes.js`) ; `/admin/orders/:ref` est inchangé ;
  - entrée de menu retirée ;
  - les calculs non affichés (`sla`, `priority_orders`, `payment_mix`) sont retirés ou affichés : choisir l'affichage seulement si un mock l'exige.
- **Dépendances :** L1.
- **Tests :**
  - unitaires `orders-decision`, `operations-decision`, `bootstrap-html-routes` ;
  - e2e `layout-canon-conformance` et role-matrix.
- **Critère d'acceptation :** les deux files sont visibles sur Opérations ; `/admin/orders` répond 302 vers Opérations ; Order 360 est inchangé.
- **Rollback :** revert ; la route redevient le dashboard.

### L4 — Parcours avec contexte · P1 · S
- **Objectif :** NAV-05, NAV-06, DASH-10.
- **Périmètre :**
  - `nav.withReturnTo` sur tous les liens vers les fiches 360 et les PO depuis `action-center.js`, `pilotage*.js`, `operations*.js`, `commerce*.js` ;
  - le serveur `action-center-workspace.js:89-146` reste source des hrefs, le front ajoute le retour ;
  - suppression du lien de recalibrage, et paramètres de filtre lus ou retirés ;
  - lien « Traiter » vers l'Action Center sur les blocs Signaux d'Opérations et de Finance.
- **Dépendances :** aucune.
- **Tests :**
  - unitaires des écrans touchés ;
  - nouveau scénario e2e : Action Center → Order 360 → Retour revient à l'Action Center.
- **Critère d'acceptation :** le retour revient à l'écran d'origine sur les 4 points d'entrée.
- **Rollback :** revert.

### L5 — Live fiable · P1 · S
- **Objectif :** LIVE-01 à LIVE-05, LIVE-07, LIVE-08.
- **Périmètre :**
  - côté front : `live-kit.js`, `import-runtime.js` (écouteurs uniques, pause quand l'onglet est masqué, état périmé, heure serveur) ;
  - côté services : `hub-dashboard-queries.js`, `relay-dashboard-queries.js` (erreurs propagées, `in_transit`, données personnelles retirées, `generated_at`). Ces services appartiennent aux features hub et relais : vérifier `arch:impact`, puis les consommateurs `/hub` et `/relais` avant de retirer des champs.
- **À préserver :**
  - la coque et le visuel Live (décision utilisateur) ;
  - la lecture seule ;
  - les intervalles actuels.
- **Dépendances :** aucune.
- **Tests :** `hub-live-journey`, `relay-live-journey`, import-runtime unitaires et e2e `live-ops-shell` (déjà instables d'après le plan Prod : stabiliser d'abord, conformément à la règle décidée).
- **Critère d'acceptation :**
  - 1 relecture par intervalle après 5 navigations ;
  - l'heure affichée est celle du serveur ;
  - « Tous » inclut les colis en transit ;
  - aucun champ de contact dans les réponses des endpoints Live.
- **Rollback :** revert.

### L6 — Résolution avec preuve dans l'Action Center · P1 · M
- **Objectif :** DASH-09, DASH-04.
- **Périmètre :**
  - `signal-admin-service.js` (prédicat de périmètre partagé avec `_helpers.js`), `action-center.js` ;
  - politique D3 : pour les types auto-résolus par un générateur, pas de « Résolu » manuel (« se ferme automatiquement quand … ») ; pour les autres, une note est obligatoire et tracée.
  - La table `signals` appartient à la feature signaux : validation de son propriétaire requise.
- **Dépendances :** D3, L4.
- **Tests :** `signal-admin-service`, `action-center` unitaires, e2e Action Center.
- **Critère d'acceptation :**
  - le compteur du Pilotage = la longueur de la liste de l'Action Center sur le même périmètre ;
  - aucune résolution manuelle d'un type auto-résolu.
- **Rollback :** revert (aucune migration si la note est stockée dans un champ existant ; sinon, migration additive à valider).

### L7 — Une projection Hub et Relais · P2 · M
- **Objectif :** LIVE-06 (D4).
- **Périmètre :** les comptages communs Live et workspace passent par une seule fonction du service propriétaire ; « Disponibles au relais » a une seule unité (commande ou colis, à trancher).
- **Dépendances :** L5, D4.
- **Tests :** unitaires des deux services ; e2e workspace Opérations.
- **Critère d'acceptation :** même chiffre sur Hub live, Relais live et Hub & Relais pour une même fixture.

### L8 — Marchés au canon et gestion des marchés · P2 · M
- **Objectif :** UX-02, NAV-07, NAV-11.
- **Étape A :** les 3 pages autonomes chargent les feuilles canon (Hero, visual canon, layout canon) et des versions à jour ; un seul Hero sur `access.html`.
- **Étape B (après D5) :** l'interface de gestion des marchés (création, ouverture, suspension) est servie dans le canonique, en réutilisant `/api/admin/markets` (aucune nouvelle API), et coordonnée avec le chantier « Créer un nouveau marché ».
- **Étape C (optionnelle) :** montage dans la SPA après levée des bloqueurs listés en §9.
- **Tests :** `canonical-standalone-shell-v4`, `canonical-hybrid-shell-v4` (`HTML_SURFACES`), e2e marché.
- **Critère d'acceptation :** un seul titre sur `access.html` ; même cadre et même Hero que la SPA.

### L9 — Retrait Legacy · P2 · M
- **Objectif :** §9, retraits conditionnels.
- **Ordre :**
  1. SettingsView et `/admin/settings?legacy=1`, plus le commentaire `html-routes.js:322` ;
  2. retrait exceptionnel avec code migré vers Relais ou Hub & Relais, puis suppression de `admin-legacy/` (servi en statique, voir §9) ;
  3. Customs et Transitaire migrés vers Expéditions & Douane ;
  4. fermeture des `?legacy=1` après D7 ;
  5. Sales, Santé, Suppliers selon D6.
- **Vérification avant chaque suppression :** routes, portail, `app.js` Legacy, tests (`bootstrap-html-routes.test.js:358-376,427`), feature cards, scripts (`arch-check.js`), emails. La recherche textuelle ne suffit pas.
- **Critère d'acceptation :** aucune route servie ne pointe vers un fichier supprimé ; `map:check` est vert.

### L10 — Fusion CSS et finitions Hero · P2 · L
- **Objectif :** UX-01 (= B2b), UX-03 à UX-07.
- **Périmètre :** fusionner les couches de thème et de coque dans les tokens et le canon, **sans changement visuel** (diff de captures sur Tour de contrôle, Action Center, Opérations, Finance, Achats) ; Paramètres et Démo en hero-first ; filtre de Comptabilité hors du Hero ; vues exclusives pour Hub & Relais.
- **Dépendances :** aucune fonctionnelle. Les captures de référence ne sont faites qu'après la fusion (règle Prod).
- **Critère d'acceptation :** moins de feuilles ; diff de captures nul sur les 5 écrans ; e2e layout vert.

---

## 11. Validation

- **Par lot :**
  - tests unitaires touchés et complétion au contact (AGENTS §8) ;
  - `PR_BODY= node scripts/touched-tests-gate.js --base origin/main --strict` ;
  - `npm run pr:preflight` vert avant push ;
  - CI verte ;
  - merge ;
  - déploiement vérifié.
- **Non-régressions permanentes :**
  - e2e `layout-canon-conformance`, `admin-menu-navigation`, `dashboard-role-matrix`, `purchasing-workspace` ;
  - Live : `hub-live-journey` et `relay-live-journey`.
- **Nouvelles preuves à créer :**
  - matrice menu ↔ capability serveur (L2) ;
  - définition unique des statuts actifs (L1) ;
  - parcours retour Action Center → Order 360 (L4) ;
  - relectures Live bornées après navigation (L5) ;
  - compteur Pilotage = liste Action Center (L6).
- **Avant tout retrait :** preuve de couverture canonique et inventaire des consommateurs (L9).

---

## 12. Risques et décisions ouvertes

| ID | Décision | Recommandation |
|---|---|---|
| D1 | Regrouper le menu par domaine (Commerce / Opérations / Finance) au lieu de Flux / Entités / Workspaces : modifie `ADMIN_NAVIGATION_DOCTRINE_V3` et le test `canonical-hybrid-shell-v4.test.js:94` | Oui : le menu suit les métiers, pas la typologie technique |
| D2 | Faut-il un index des commandes (liste filtrable) une fois Commandes fusionnée ? | Non pour l'instant : recherche par référence + files Opérations ; à rouvrir sur un besoin réel |
| D3 | Politique du « Résolu » de l'Action Center | Pas de résolution manuelle pour les types auto-résolus ; note obligatoire pour les autres (cohérent avec « pas de GREEN sans preuve » déjà décidé pour les agents) |
| D4 | Unité et propriétaire du comptage Hub et Relais (colis ou commande) | Service `operations-workspace` comme propriétaire ; les Live le consomment |
| D5 | Où vit la gestion des marchés (créer, ouvrir, suspendre) ? | Marchés › Marchés (admin), dans le chantier « Créer un nouveau marché » |
| D6 | Sales (cohortes, îles), Santé (corrélations) et CRUD Partenaires : migrer ou abandonner ? | Décision métier ; tant qu'elle n'est pas prise, garder le Legacy via `/portail` |
| D7 | Date de fermeture des rollbacks `?legacy=1` | Domaine par domaine, après 2 semaines sans usage constaté |
| D8 | Le rôle finance doit-il voir la vue d'ensemble Finance (aujourd'hui seulement Comptabilité) ? | Oui si `finance.read` ; à confirmer |
| D9 | L'admin doit-il voir les écrans locaux d'un marché (Autonomie, Catalogue pays) ? | Oui, en lecture, via le sélecteur de marché |

**Risques :**
- **L1 :** des chiffres vont changer en production. C'est voulu, à annoncer.
- **L5 :** retirer des champs de contact peut casser un consommateur terrain non identifié ; vérifier `/hub` et `/relais` avant.
- **L9 :** le portail est la seule porte du support ; ne pas le retirer avant SharedCarts.

---

## Verdict final

1. **Entrées de menu retirées ou fusionnées : 3.**
   - Produits, fusionné dans le Catalogue.
   - Commandes, fusionnée dans Opérations.
   - Le doublon Paramètres.
   
   S'y ajoutent 7 renommages et, avec D1, le regroupement de 22 entrées en 6 groupes métier. Pour les agents, « Action Center » est masqué tant que l'API les refuse.
2. **Dashboards réellement nécessaires : 5 de décision + 3 cockpits Live.**
   - Décision : Tour de contrôle, À traiter, Commerce, Opérations, Finance.
   - Live : Sourcing, Hub, Relais.
3. **Dashboards redondants :**
   - Commandes (`/admin/orders`), avec Opérations et Commerce ;
   - partiellement, Hub & Relais workspace et Hub/Relais live, sur les comptages seulement : les actions restent dans le workspace.
4. **Capacités existantes invisibles ou mal exposées :**
   - gestion des marchés (`/api/admin/markets`) ;
   - retrait exceptionnel avec code (`/api/pickup/*`, Legacy 0 seulement) ;
   - taux douaniers effectifs ;
   - envoi transitaire en lot et historique ;
   - support des paniers partagés (Legacy seulement) ;
   - escalade et commentaires Hub/Relais (API sans appelant) ;
   - `sla`, `priority_orders` et `payment_mix` de Commandes, calculés sans être affichés.
5. **Parcours incomplets :**
   - retour depuis Order 360 ouvert par l'Action Center, le Pilotage, les Opérations ou le Commerce ;
   - résolution d'un signal sans preuve ;
   - recherche → objet logistique ;
   - Pilotage → filtres de Finance et d'Opérations ;
   - gestion des marchés ;
   - Legacy uniquement par `/portail`, fermé à 4 rôles.
6. **Composants à rendre canoniques :**
   - Hero hero-first et kicker champagne ;
   - `.kmc-metric-card` ;
   - `ui.Section` et `ui.UIState` ;
   - `nav.withReturnTo` ;
   - `live-kit` comme moteur Live unique ;
   - constantes de statut et de seuil dans `dashboard-metrics/_helpers.js`.
7. **Écrans Legacy supprimables sans risque démontré :**
   - SettingsView Legacy et son rollback ;
   - l'entrée `/admin/suppliers` du routeur client.
   
   `admin-legacy/` devient supprimable après la migration du retrait exceptionnel avec code. Les 7 écrans Legacy obligatoires ne sont pas supprimables aujourd'hui.
8. **Nombre minimal de lots : 6 pour la cible P0/P1 (L1 à L6), 10 pour la cible complète.**

| Lot | Priorité | Périmètre | Résultat attendu | Validation |
|---|---|---|---|---|
| L1 | P0/P1 | KPI commandes, paiements, retards | une seule définition par libellé | test statuts ⊂ machine d'états ; même chiffre Pilotage = Commandes |
| L2 | P1 | menu, capabilities, doublons, libellés | le menu ne promet que l'accessible | matrice menu ↔ serveur ; e2e menu |
| L3 | P1 | Commandes → Opérations | 5 dashboards de décision | 302 `/admin/orders` ; files visibles |
| L4 | P1 | `returnTo`, liens morts, liens vers l'Action Center | retour à l'origine | e2e Action Center → 360 → retour |
| L5 | P1 | moteur Live et services Hub/Relais | Live honnête, sans données personnelles | relectures bornées ; heure serveur |
| L6 | P1 | résolution des signaux, compteur Pilotage | aucune clôture sans preuve | compteur = liste ; tests du service |
| L7 | P2 | projection Hub et Relais | une vérité opérationnelle | même chiffre sur 3 écrans |
| L8 | P2 | pages Marchés et gestion des marchés | Marchés au canon, gestion des marchés exposée | un seul Hero ; e2e marché |
| L9 | P2 | retrait Legacy | moins de code mort | `map:check` ; aucune route vers un fichier supprimé |
| L10 | P2 | fusion CSS et finitions Hero | moins de couches, rendu identique | diff de captures nul sur 5 écrans |
