# Doctrine Canonique — Dashboards Komerce orientés décision V1

> Statut : **FIGÉ — contrat produit / UX / représentation avant implémentation**  
> Date : 2026-09-11  
> Dépend de : `docs/doctrine/ADMIN_NAVIGATION_DOCTRINE_V2.md`  
> Trace des mocks : `docs/contract/DASHBOARD_MOCK_TRACE_V1.md`  
> Principe directeur : **un coup d’œil → comprendre l’état → voir le problème → décider → entrer dans le détail si nécessaire**.

---

## 1. Décision produit

Les dashboards Komerce ne sont pas des pages de reporting ni des collections de tableaux génériques.

Ils doivent répondre, dans cet ordre, à cinq questions :

1. **Que se passe-t-il maintenant ?**
2. **Qu’est-ce qui va bien / mal ?**
3. **Qu’est-ce qui mérite mon attention ?**
4. **Quelle décision dois-je prendre ?**
5. **Où dois-je entrer dans le détail pour agir ?**

La vue d’ensemble doit donc être compréhensible **avant lecture d’un tableau détaillé**.

Le détail reste disponible par drill-down, mais il ne doit jamais être nécessaire pour découvrir qu’un problème important existe.

### Formule canonique

> **Vue d’ensemble = état + tendance + risque + priorité + décision.**  
> **Drill-down = preuve + détail + action métier.**

---

## 2. Relation avec le shell et les droits

La doctrine visuelle s’insère dans la navigation Admin V2 :

- **N1** = domaines métier stables ;
- **N2** = vues / workspaces du domaine ;
- le contexte `Market ID` reste visible ;
- l’affichage dépend des droits serveur effectifs ;
- une carte ou un CTA ne doit jamais exposer une destination qui finit en `403`.

Le visuel ne donne aucun droit. Il **projette** les capabilities et les données que le backend a déjà autorisées.

Le `market_operator` voit les mêmes types de représentation que l’admin, mais uniquement sur son Market ID et seulement pour les domaines livrés par ses capabilities.

---

## 3. Anatomie canonique d’une vue d’ensemble

Toutes les vues d’ensemble n’ont pas besoin de tous les composants, mais elles doivent suivre la même grammaire.

### 3.1. Header de contexte

Doit contenir :

- chip de domaine / workspace ;
- titre orienté métier ;
- sous-titre expliquant la décision couverte ;
- contexte marché ;
- période / fraîcheur ;
- éventuel CTA `Voir le rapport ...`.

### 3.2. Bandeau de décision — priorité absolue

En haut de page, avant les KPI : **3 à 4 cartes maximum**.

Elles représentent des situations qui nécessitent une lecture immédiate :

- critique ;
- attention ;
- problème de qualité / complétude ;
- décision à prendre aujourd’hui.

Chaque carte doit contenir :

- un libellé métier ;
- un nombre / montant ;
- une indication de sens ou d’évolution si elle est réellement comparable ;
- un CTA vers la liste concernée.

Une carte de décision ne doit pas être un simple KPI décoratif.

### 3.3. KPI clés

Les KPI décrivent la santé du domaine.

Règles :

- 4 à 6 KPI visibles sans scroll important ;
- valeur principale lisible ;
- unité explicite ;
- tendance seulement si la comparaison est valide ;
- micro-sparkline uniquement lorsqu’une série temporelle réelle existe ;
- pas de valeur manquante transformée en zéro.

### 3.4. Représentation adaptée à la forme de la donnée

Le renderer ne doit pas forcer toutes les données dans une table.

| Forme de donnée | Représentation canonique |
|---|---|
| valeur instantanée | KPI card |
| évolution temporelle | sparkline / courbe / barres |
| répartition | barres horizontales / barre segmentée |
| progression vers seuil | progress bar / gauge sobre |
| étapes successives | funnel ou pipeline |
| état par entité | table priorisée + badges |
| classement | ranked list / ranked table |
| réseau / sites | cartes comparatives par hub / relais |
| readiness | score + prochaine décision |
| prix / contribution | table économique + plage de marché |
| scénarios | scenario cards avec impact |
| droits / visibilité | chips par profil / domaine |
| alertes | liste priorisée par sévérité |
| actions recommandées | checklist / action list |

### 3.5. Bloc « problèmes / alertes »

Une vue où des anomalies métier existent doit avoir un bloc explicite :

- `Alertes`, `Signaux`, `Problèmes`, `Points de friction` ou formulation métier équivalente ;
- sévérité visible ;
- ancienneté si pertinente ;
- propriétaire si disponible ;
- CTA vers le détail.

### 3.6. Bloc « actions prioritaires »

Lorsqu’un domaine permet de déduire des prochaines actions fiables, afficher au maximum **3 à 5 actions**.

Une action doit répondre à :

- quoi faire ;
- pourquoi ;
- priorité ;
- destination pour agir.

Le dashboard ne doit pas inventer une action que le backend ne sait pas justifier.

### 3.7. Footer de confiance

Les vues décisionnelles affichent lorsque disponible :

- dernière mise à jour ;
- qualité / complétude des données ;
- éventuels warnings de qualité ;
- scope marché courant.

---

## 4. Règles de vérité des données

### 4.1. Le navigateur ne recalcule pas la vérité métier

Les dashboards projettent des valeurs produites par les services canoniques.

Le frontend peut :

- formater ;
- ordonner ;
- choisir une représentation ;
- agréger uniquement lorsque le contrat serveur fournit explicitement les éléments nécessaires et que cette agrégation est de pure présentation.

Le frontend ne doit pas reconstruire un KPI métier depuis des lignes brutes si un owner serveur existe.

### 4.2. Valeur manquante ≠ zéro

Valeurs recommandées :

- `—` pour inconnu ;
- `Incomplet` pour vérité partielle ;
- warning explicite lorsque la décision est affectée.

### 4.3. Tendance comparable uniquement

Un delta ne s’affiche que si :

- la période de comparaison existe ;
- le périmètre est identique ;
- l’unité est cohérente ;
- le backend marque la comparaison comme valide ou fournit une série comparable.

### 4.4. Market scope

Toute vue pays doit être bornée serveur par le Market ID autorisé.

Aucune donnée globale ou cross-market ne doit apparaître par effet de bord dans un dashboard pays.

### 4.5. Monnaie

La devise affichée vient du marché / contrat serveur.

Les mocks utilisent souvent `KMF` pour matérialiser le principe ; l’implémentation doit afficher la monnaie réelle du Market ID.

---

## 5. Doctrine Alertes / Problèmes / Action Center

Le dashboard doit rendre les problèmes visibles, mais **ne recrée pas un moteur d’anomalies par page**.

L’Action Center / `decision-signals` reste l’autorité du cycle de vie des signaux lorsqu’il est applicable.

Les dashboards consomment des **projections** de signaux adaptées à leur domaine :

- Pilotage : alertes transverses ;
- Commerce : risques commerciaux ;
- Opérations : incidents / tension réseau / transit ;
- Finance : coûts incomplets / paiements / variances ;
- Catalogue : qualité contenu / exposition ;
- Sourcing : ruptures / fournisseurs / délais / prix ;
- Marchés : droits / validations / readiness.

### Interdictions

- ne pas dupliquer les règles de détection dans le frontend ;
- ne pas ressusciter `ProblemsView` comme moteur parallèle ;
- ne pas inventer un `market_id` côté navigateur ;
- ne pas donner au Responsable pays l’Action Center global admin-only ;
- ne pas masquer un signal seulement parce qu’il n’a pas encore une représentation « jolie ».

---

## 6. Contrats par dashboard / workspace

Les blocs ci-dessous constituent la **cible minimale de représentation**. Une donnée non encore disponible côté backend devient un gap explicite, jamais une raison de supprimer silencieusement la zone du produit cible.

### 6.1. Dashboard · Pilotage

**But :** comprendre l’état global du marché en moins de 10 secondes.

**Bandeau décision :**
- Critiques ouvertes ;
- Points d’attention ;
- Problèmes costing / complétude ;
- Décisions à prendre aujourd’hui.

**KPI clés :**
- CA encaissé ;
- Commandes actives ;
- Marge consolidée ;
- Alertes critiques ;
- Complétude des coûts.

**Représentations :**
- cartes `Commerce`, `Opérations`, `Finance`, `Catalogue pays` ;
- boucle économique : Prix estimé → Commande → Paiement → Colis & scans → Coût réel → Marge consolidée → Recalibrage ;
- alertes système transverses ;
- principes non négociables ;
- fraîcheur / qualité données.

### 6.2. Dashboard · Commerce

**But :** comprendre traction, conversion et arbitrages commerciaux.

**Bandeau décision :**
- Ruptures sur best-sellers ;
- Prix à recalibrer ;
- Conversions sous cible ;
- Décisions commerciales aujourd’hui.

**KPI clés :**
- CA vendu / encaissé selon contrat ;
- Panier moyen ;
- Taux de conversion ;
- Commandes perdues ;
- Produits actifs vendus.

**Représentations :**
- top catégories / rayons ;
- canaux de vente ;
- top produits en croissance ;
- tunnel commercial Visites → Estimations → Paiements → Commandes livrées ;
- pertes entre étapes ;
- alertes commerciales ;
- produits à arbitrer maintenant ;
- actions prioritaires.

### 6.3. Atelier économique · Vue d’ensemble

**But :** dire la vérité du prix, du coût et de la contribution sans pousser artificiellement les charges fixes au SKU.

**Bandeau décision :**
- SKUs à recalibrer ;
- Coûts incomplets ;
- Contribution sous cible ;
- Décisions pricing aujourd’hui.

**KPI clés :**
- Contribution réelle ;
- Couverture coûts ;
- Commandes contributives ;
- Colis contributifs ;
- CDR moyen ;
- Marge consolidée.

**Représentations :**
- capacité contributive par SKU ;
- plage de marché basse / cible / haute ;
- prix actuel ;
- contribution unitaire ;
- taux de couverture ;
- décision recommandée ;
- plan d’équilibre : articles/jour, commandes/jour, colis/jour minimum vs actuel ;
- simulations rapides avec impact ;
- problèmes qui faussent la décision : coûts manquants, imputations partielles, SKU hors plage marché, double comptage ;
- principes économiques non négociables.

### 6.4. Catalogue pays · Vue d’ensemble

**But :** piloter ce qui est réellement visible et vendable sur le marché.

**Bandeau décision :**
- Produits sans prix local ;
- Fiches à compléter ;
- Médias manquants ;
- Produits à publier.

**KPI clés :**
- Produits actifs ;
- Taux d’exposition ;
- Couverture images ;
- Traductions complètes ;
- Produits en attente de validation.

**Représentations :**
- configuration locale : rayons mis en avant, bannière, catégories prioritaires, tri storefront, visibilité ;
- produits à corriger maintenant ;
- santé du catalogue par rayon ;
- top rayons performants ;
- alertes catalogue ;
- CTA de correction ciblée.

### 6.5. Commandes · Vue d’ensemble

**But :** faire avancer les commandes sans friction et protéger la promesse client.

**Bandeau décision :**
- Paiements en attente ;
- Commandes bloquées ;
- Retraits en retard ;
- Litiges ouverts.

**KPI clés :**
- Commandes créées ;
- Payées ;
- Expédiées ;
- Disponibles relais ;
- Retirées.

**Représentations :**
- funnel de conversion ;
- pertes entre chaque étape ;
- commandes perdues ;
- SLA & promesse client : délai moyen, % dans les temps, >72h sans mouvement, prêtes aujourd’hui ;
- commandes prioritaires ;
- alertes et problèmes ;
- actions `Relancer`, `Traiter`, `Contacter`, `Ouvrir` selon capability.

### 6.6. Marchés · Vue d’ensemble

**But :** voir autonomie, accès, équipe et readiness du Market ID.

**Bandeau décision :**
- Invitations en attente ;
- Accès à réviser ;
- Tests bloqués ;
- Décisions d’activation.

**KPI clés :**
- Market IDs actifs ;
- Managers pays ;
- Membres délégués ;
- Capabilities terrain actives ;
- Audits récents.

**Représentations :**
- profils & domaines visibles ;
- équipe du marché : membre, rôle, périmètre, dernière action, statut ;
- readiness Catalogue / Commandes / Opérations / Finance ;
- prochaine décision par domaine ;
- alertes droits / garde-fous multi-marchés / validations / audit.

### 6.7. Opérations · Vue d’ensemble

**But :** donner la photographie de l’exécution avant d’entrer dans les workspaces.

**Bandeau décision :**
- Incidents critiques ;
- Points d’attention ;
- Cash à sécuriser ;
- Décisions terrain aujourd’hui.

**KPI clés :**
- Commandes prêtes ;
- Colis en transit ;
- Dossiers douane ouverts ;
- Relais actifs ;
- Taux de service réseau.

**Représentations :**
- trois cartes d’entrée `Hub / Relais`, `Expéditions & Douane`, `Sourcing` ;
- réseau & exécution ;
- signaux opérations ;
- points de friction à traiter ;
- actions prioritaires aujourd’hui.

### 6.8. Opérations · Hub / Relais

**But :** piloter réseau terrain, collecte, disponibilité et cash.

**Bandeau décision :**
- Collectes en retard ;
- Hubs en tension ;
- Relais à approvisionner ;
- Cash à sécuriser.

**KPI clés :**
- Disponibles relais ;
- Taux de collecte ;
- Commandes prêtes ;
- Relais actifs ;
- Incidents terrain.

**Représentations :**
- performance réseau : hub principal / relais urbains / relais secondaires ;
- signaux opérations ;
- table relais à suivre ;
- actions prioritaires.

### 6.9. Opérations · Expéditions & Douane

**But :** visualiser le transit, les blocages et les dossiers documentaires avant l’action spécialisée.

**Bandeau décision :**
- Colis bloqués ;
- Dossiers douane à traiter ;
- Transit > seuil ;
- Documents expirants.

**KPI clés :**
- Expéditions en cours ;
- Dossiers douane ouverts ;
- Délai moyen ;
- Coûts logistiques ;
- Taux conformité documents.

**Représentations :**
- flux international segmenté ;
- prochains arrivages ;
- dossiers douane prioritaires ;
- suivi des expéditions ;
- alertes documentaires ;
- actions prioritaires.

### 6.10. Opérations · Sourcing

**But :** sécuriser l’approvisionnement et anticiper les ruptures / dérives fournisseurs.

**Bandeau décision :**
- Demandes sourcing urgentes ;
- Fournisseurs en retard ;
- Références à restocker ;
- Décisions achats aujourd’hui.

**KPI clés :**
- Références actives ;
- Couverture stock ;
- Délai moyen d’approvisionnement ;
- Taux de service fournisseurs ;
- Coût d’achat moyen.

**Représentations :**
- besoins à commander ;
- performance fournisseurs ;
- pipeline Besoin → Validation → Commande fournisseur → En transit → Reçu ;
- alertes sourcing : prix, MOQ, dépendance unique, délai, qualité ;
- actions prioritaires.

### 6.11. Finance · Vue d’ensemble

**But :** lire la vérité financière du marché et identifier les éléments empêchant une marge fiable.

**Bandeau décision :**
- Paiements en attente ;
- Coûts incomplets ;
- Variances élevées ;
- Remboursements à suivre.

**KPI clés :**
- CA encaissé ;
- Coût réel ;
- Marge consolidée ;
- Complétude des coûts ;
- Encaissements non rapprochés.

**Représentations :**
- trajectoire financière CA / coût réel / marge ;
- commandes à coût incomplet ;
- encaissements par mode ;
- rentabilité par relais ;
- alertes remboursements / paiements / costing / justificatifs ;
- drill vers Comptabilité / encaissements / rapprochements selon droit.

### 6.12. Dashboard · Alertes / Action Center

**But :** traiter le cycle de vie des signaux sans créer un moteur parallèle.

**Représentations :**
- résumé par sévérité : critique / warning / information ;
- filtres par famille / statut / owner lorsqu’autorisés ;
- liste priorisée des signaux ;
- âge du signal ;
- recommandation ;
- drill métier ;
- actions de lifecycle `acknowledge`, `snooze`, `resolve` seulement si autorisées.

Le Responsable pays ne reçoit pas automatiquement l’autorité Action Center globale : ses vues pays consomment des projections market-scoped existantes.

---

## 7. N2 détaillés — règle de densité

Les pages N2 détaillées (`Paiement`, `Préparation`, `Coûts`, `Remboursements`, `Produits`, `Exposition`, `Équipe & délégation`, etc.) **ne doivent pas recopier intégralement la vue d’ensemble**.

Elles réutilisent la même grammaire mais concentrent l’écran sur :

1. 1 à 3 alertes / décisions du sous-domaine ;
2. 3 à 5 KPI spécialisés ;
3. la représentation la plus pertinente ;
4. la liste de travail / table métier ;
5. l’action.

---

## 8. Composants UI canoniques à extraire / généraliser

L’implémentation doit converger vers un petit vocabulaire partagé :

- `DecisionCard` ;
- `KpiCard` avec optional delta / sparkline ;
- `OverviewEntryCard` ;
- `SegmentedStatusBar` ;
- `ProgressMetric` ;
- `TrendChart` ;
- `Funnel` ;
- `Pipeline` ;
- `RankedList` ;
- `ActionTable` ;
- `SignalList` ;
- `PriorityChecklist` ;
- `ReadinessCard` ;
- `DataQualityFooter`.

Ces composants sont **de présentation**. Ils ne portent pas de logique métier cachée.

---

## 9. Anti-patterns interdits

- un dashboard composé uniquement de tables ;
- des KPI génériques non reliés à une décision ;
- une multiplication de cartes qui oblige à tout lire ;
- plus de 4 alertes principales au-dessus de la ligne de flottaison ;
- des microcharts inventés faute de série temporelle ;
- des pourcentages sans dénominateur métier clair ;
- une couleur rouge utilisée pour une simple baisse positive ou une baisse dont le sens métier est favorable ;
- des données manquantes affichées à `0` ;
- des CTA vers des routes non autorisées ;
- des alertes reconstruites différemment dans chaque page ;
- un « beau mock » qui invente une donnée non disponible sans tracer le gap backend.

---

## 10. Contrat d’implémentation

Avant de coder chaque écran, produire une matrice :

`bloc visuel → donnée attendue → source serveur → scope → qualité → CTA → capability → statut`.

Statuts autorisés :

- `PROVEN` : source existante prouvée ;
- `PROJECTABLE` : donnée existante mais non encore projetée par le frontend ;
- `BACKEND_GAP` : donnée cible non encore fournie ;
- `UI_GAP` : source prête mais représentation absente ;
- `DEFERRED` : volontairement hors lot.

Une PR de généralisation visuelle ne doit pas masquer les `BACKEND_GAP` en fabriquant des valeurs de démonstration dans le code production.

---

## 11. Ordre d’exécution recommandé

1. extraire les primitives UI canoniques ;
2. Pilotage ;
3. Opérations vue d’ensemble + Hub / Relais + Expéditions & Douane ;
4. Finance ;
5. Commandes ;
6. Commerce ;
7. Atelier économique ;
8. Catalogue pays ;
9. Sourcing ;
10. Marchés / droits / readiness ;
11. Action Center / Alertes ;
12. audit visuel desktop / responsive / rôles ;
13. audit `payload disponible → information visible → décision possible`.

Le lot n’est terminé que lorsque les données importantes du payload ne disparaissent plus silencieusement entre le backend et l’écran.

---

## 12. Critères de validation

Une vue est conforme si :

- l’utilisateur comprend l’état du domaine en quelques secondes ;
- les problèmes sont visibles sans ouvrir une table ;
- les KPI critiques sont contextualisés ;
- les représentations correspondent à la nature des données ;
- les actions prioritaires sont claires ;
- le drill-down mène au bon détail ;
- les droits et le Market ID sont respectés ;
- la qualité / fraîcheur des données est visible ;
- aucun KPI métier n’est recomputé arbitrairement dans le navigateur ;
- aucun problème important fourni par le backend n’est perdu par la projection UI.

> **Komerce ne doit pas seulement montrer des données. Komerce doit montrer quoi comprendre, quoi surveiller et quoi décider.**
