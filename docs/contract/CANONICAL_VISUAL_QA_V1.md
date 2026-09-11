# CANONICAL VISUAL QA V1

Statut : **contrat de QA actif**

Références :
- `docs/doctrine/DASHBOARD_DECISION_VISUAL_DOCTRINE_V1.md`
- `docs/contract/DASHBOARD_DECISION_IMPLEMENTATION_V1.md`
- `public/dashboards/canonical/css/visual-freeze-v1.css`

## 1. But

Le freeze visuel n'est pas un simple thème. Le contrôle final doit prouver qu'à chaque surface Canonical :

> **un coup d'œil donne l'état, les anomalies réellement prouvées et la prochaine destination utile ; le détail ne vient qu'ensuite.**

Le QA vérifie simultanément :

1. cohérence du shell N1/N2 ;
2. absence de doublons de contexte (Market ID, retour, filtres) ;
3. hiérarchie `décision → KPI → détail → action` ;
4. fidélité aux données serveur — jamais de signal visuel inventé ;
5. adaptation desktop / tablette / mobile ;
6. séparation dashboard / workspace / Entity 360 ;
7. respect des rôles et du scope marché.

## 2. Viewports de référence

| Nom | Largeur | Attendu |
|---|---:|---|
| Desktop large | 1440–1920 px | N1 sur une ligne, N2 contextuel, cartes multi-colonnes |
| Desktop compact | 1024–1320 px | navigation compacte sans clipping, tables scrollables |
| Mobile | 360–430 px | une colonne, actions accessibles, aucun contenu horizontal perdu |

## 3. Matrice des surfaces

| Surface | Route canonique | Rôle principal | One-glance | Drill-down / action | État QA |
|---|---|---|---|---|---|
| Pilotage | `/admin/pilotage` | admin / market_operator | Decision strip + KPI + vues + alertes | domaines métier | READY |
| Commerce / Commandes | `/admin/commerce` | admin / market_operator | décision + KPI + funnel | Order 360 / Client 360 | READY |
| Atelier économique | `/admin/workspaces/pricing` | admin / market_operator | état économique + frontières + couverture | simulation / mutation pricing | READY |
| Catalogue global | `/admin/workspaces/catalog` | admin | curation + relecture + cap | Product 360 / validation | READY |
| Catalogue pays | `/dashboards/canonical/market-catalog.html` | market_operator | exposition actuelle | exposer / masquer | **PARTIAL** |
| Marchés admin | `/dashboards/canonical/access.html` | admin | scopes / managers / gaps | provisioning | READY |
| Autonomie pays | `/dashboards/canonical/market-autonomy.html` | market_operator | état du Market ID | équipe / cash / décisions locales | READY |
| Opérations overview | `/admin/operations` | admin / market_operator | incidents + flux | workspaces opérationnels | READY |
| Hub / Relais | `/admin/workspaces/operations` | terrain / market_operator | files à traiter | actions métier | READY |
| Expéditions & Douane | `/admin/workspaces/shipping-customs` | transitaire / market_operator | blocages + files | actions expédition/douane | READY |
| Sourcing | `/admin/workspaces/sourcing` | sourcing | besoins + fournisseurs + pipeline | actions sourcing | READY |
| Finance overview | `/admin/finance` | admin / market_operator | anomalies + vérité financière | comptabilité / pricing | READY |
| Comptabilité | `/admin/workspaces/accounting` | finance / agent_relais / admin | cash non encaissé + dépôts + rapprochement | vérifier / contester / déclarer | **FIXED IN QA PASS 1** |
| Action Center | `/admin/action-center` | admin global | familles + sévérité + lifecycle | acknowledge / snooze / resolve | READY |
| Order 360 | `/admin/orders/:reference` | autorisé | synthèse entité | détail commande | DRILLDOWN |
| Client 360 | `/admin/clients/:phone` | autorisé | synthèse entité | détail client | DRILLDOWN |
| Product 360 | `/admin/products/:productRef` | autorisé | synthèse entité | détail produit | DRILLDOWN |

## 4. Findings QA Pass 1

### QA-001 — Comptabilité sans couche de décision

**Constat :** le workspace affichait des KPI corrects (`pending_deposits`, `uncollected_kmf`) et les écarts de rapprochement, mais l'utilisateur devait lire plusieurs blocs avant de savoir quoi traiter.

**Correction :** `finance-accounting-workspace-decision.js` projette :
- Cash non encaissé ;
- Dépôts à vérifier ;
- synthèse attendu / collecté / vérifié ;
- écarts collecte / dépôt déjà calculés par le backend.

Aucun seuil nouveau n'est calculé côté navigateur.

### QA-002 — double sélecteur Market ID dans Catalogue pays

**Constat :** le Market ID est déjà contrôlé dans la barre Canonical. `market-catalog.js` rendait encore un second sélecteur dans le corps de page.

**Correction :** le freeze masque ce contrôle redondant lorsque le sélecteur N1 est présent. Le contrôle interne reste dans le DOM comme relais technique de navigation, mais l'utilisateur ne voit qu'une seule autorité de contexte.

### QA-003 — Catalogue pays reste trop « configuration »

**Constat :** le payload actuel expose uniquement les décisions d'exposition déjà créées. Les produits sans ligne sont implicitement `DISABLED` mais ne sont pas listés par `listExposureForMarket`. On ne peut donc pas afficher honnêtement « produits à publier », « couverture du catalogue global », « prix local manquant » ou « médias manquants » à partir de ce payload.

**Statut :** `BACKEND_GAP / READ-MODEL GAP`.

**Décision :** ne pas fabriquer ces KPI côté navigateur. Le prochain lot Catalogue pays doit enrichir le read-model serveur avant de compléter le mock.

### QA-004 — liens « Retour Dashboard » redondants et parfois non autorisés

**Constat :** plusieurs workspaces gardaient dans leur header un lien `← Dashboard Opérations` ou `← Dashboard Finance` alors que le N1/N2 Canonical assure déjà cette navigation. Pour les rôles terrain, ces liens pouvaient même pointer vers un overview auquel le rôle n'a pas accès.

**Correction :** le freeze masque les anciens liens de retour vers `/admin/operations` et `/admin/finance` lorsqu'ils occupent la première position du header. Les liens métier transverses utiles restent visibles. Si ce lien était l'unique élément du nav de workspace, le conteneur entier est masqué.

## 5. Checklist visuelle obligatoire par surface

- [ ] N1 actif visible, jamais clippé.
- [ ] N2 présent seulement si le domaine possède plusieurs espaces visibles pour le rôle.
- [ ] un seul sélecteur Market ID visible.
- [ ] titre + scope compréhensibles sans lire les tables.
- [ ] problèmes critiques/warning visibles avant les détails quand ils existent.
- [ ] absence de problème ≠ fausse carte rouge avec `0`.
- [ ] donnée absente affichée `—` ou état inconnu, jamais transformée en zéro métier.
- [ ] CTA seulement si l'utilisateur peut réellement atteindre/exécuter la destination.
- [ ] tables encapsulées et scrollables sur écran étroit.
- [ ] aucune carte purement décorative sans information utile.
- [ ] couleurs critiques/warning/positive réservées aux états sémantiques.
- [ ] pas de bouton `Retour` redondant lorsqu'un N2 assure déjà la navigation.
- [ ] responsive : aucun CTA critique ni décision masqué sous 430 px.

## 6. Critère de sortie

Le freeze est considéré **VISUAL-QA-COMPLETE** quand :

1. toutes les surfaces `READY` ont passé la checklist aux trois viewports ;
2. tous les findings sont soit corrigés, soit explicitement classés `BACKEND_GAP` / `DEFERRED` ;
3. aucune correction visuelle n'introduit de calcul métier ou de nouvelle autorité client ;
4. les gates Dashboard / Governance / Backend restent verts.
