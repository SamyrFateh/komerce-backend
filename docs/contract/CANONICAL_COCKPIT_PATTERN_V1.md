# Canonical Cockpit Pattern V1

## Décision

Le **Cockpit des imports** est le patron de pilotage Canonical à généraliser, mais uniquement comme **grammaire de présentation et de navigation**.

Il ne devient jamais propriétaire des vérités métier des autres domaines.

La cible commune est :

```text
Situation
  ↓
Flux réel
  ↓
Décisions ouvertes
  ↓
Exceptions
  ↓
Drill-down / historique
```

## Pourquoi ce patron

Le cockpit Import rend visibles quatre choses que le Back Office historique rendait mieux que les premières surfaces Canonical :

1. où l'on se trouve ;
2. ce qui a réellement traversé la chaîne ;
3. ce qui demande une décision humaine maintenant ;
4. où aller pour agir sans exposer la plomberie technique saine.

La consolidation Canonical reste correcte. Ce patron restaure la **compréhension globale** du Back Office sans recréer les anciennes 30 applications.

## Règle d'autorité

Le pattern est présentationnel.

Il est interdit à `cockpit-pattern.js` de :

- calculer un KPI métier ;
- inventer un seuil ;
- reclasser une sévérité ;
- inférer un statut ;
- muter une entité ;
- recomposer une vérité déjà possédée par un service de domaine.

Chaque domaine projette ses faits canoniques. Le cockpit les ordonne seulement.

## Domaines

### Imports

Chaîne canonique :

```text
Source → Import → Raffinerie → Taxonomie → Certification → Catalogue
                                      ↓
                              décisions aval
                                      ↓
                                  clôture
```

Imports reste le cockpit de référence pour les lots KIR.

### Pilotage

Le cockpit Pilotage expose :

- situation transverse ;
- signaux réellement ouverts ;
- flux économique / organisationnel fourni par le backend ;
- décisions à ouvrir dans les domaines propriétaires ;
- historique / Action Center en drill-down.

### Commerce

Le cockpit Commerce expose :

- situation vente ;
- funnel réel ;
- décisions commerciales serveur ;
- rentabilité/qualité connues ;
- exceptions et drill-down vers commandes, clients, pricing ou marché.

### Opérations

**Opérations ne contient que de l'opérationnel.**

Une surface appartient à Opérations si elle répond à au moins une question immédiate : « que se passe-t-il maintenant ? », « où est le flux ? », « qu'est-ce qui bloque ? », « quelle action opérateur est attendue ? ».

Le domaine expose :

- **Sourcing live / Imports** : Source → Import brut → Raffinerie → Taxonomie → Certification → Catalogue ;
- **Hub** et **Relais** : exécution terrain et files de travail ;
- **Expéditions & Douane** : exécution logistique, transit et incidents ;
- activité temps réel, progression, exceptions et décisions directement actionnables ;
- drill-down depuis chaque étape, KPI, événement et objet traité.

La configuration des sources, fournisseurs, règles, mappings, référentiels et paramètres n'appartient jamais à Opérations, même si elle sert ces flux. Elle reste dans les domaines de configuration ou les workspaces propriétaires.

### Finance

Le cockpit Finance expose :

- encaissements ;
- vérité des coûts ;
- marge ;
- complétude ;
- écarts / remboursements ;
- drill-down vers Comptabilité et Atelier économique.

### Catalogue

Catalogue reste l'autorité du produit global.

Le cockpit Catalogue doit lire :

- entrées issues des imports ;
- préparation FR ;
- taxonomie ;
- médias / SKU ;
- validation humaine ;
- état prêt à vendre global.

Il ne reprend jamais la logique de sourcing ni la décision marché.

### Marchés

Le cockpit marché répond uniquement à :

> « Ce produit global déjà validé peut-il être vendu sur CE marché maintenant ? »

Il consomme la vérité globale et ajoute les vérités marché autorisées : prix local, exposition, logistique, paiement et offre locale.

## Langage visuel

Le langage visuel est désormais **bimodal**, selon la nature de la surface.

### Cockpit LIVE — opérationnel temps réel

Les écrans temps réel de **Sourcing / Import, Hub et Relais** partagent la même nomenclature :

- fond marine / noir `#07111f` et cartes sombres à contraste élevé ;
- pipeline horizontal comme héros de page ;
- étape terminée = vert fixe avec coche ;
- **une seule étape courante** = bleu, éventuellement animée ;
- étape à venir = gris ;
- décision humaine après une frontière automatique = orange fixe, sans remettre le run « en cours » ;
- rouge uniquement pour un blocage ou une anomalie réelle ;
- KPI, étape, événement, objet courant et lignes récentes sont des **zones de drill-down** ;
- activité affichée en langage métier, jamais comme log technique brut ;
- l'objet actuellement traité reste visible à côté du flux d'activité ;
- le cockpit n'invente aucune vérité : il projette uniquement les faits fournis par le backend.

La règle de lecture est simple :

> **noir = exécution live / supervision opérationnelle.**

### Gestion, décision et configuration

Les surfaces de gestion, d'analyse, de référentiel et de configuration conservent le langage Back Office Legacy clair :

- fond `#f8f9fa` / surfaces blanches ;
- bordures fines grises ;
- très peu d'ombres ;
- orange Komerce pour rythme/navigation/action ;
- vert uniquement pour un état réellement positif ;
- orange pour attente/action ;
- rouge pour blocage/critique ;
- bleu uniquement pour information/contextualisation ;
- titres anthracite, légèrement renforcés ;
- densité de données élevée.

Le Legacy fournit la **lisibilité** ; le cockpit LIVE fournit la **présence opérationnelle**. Aucun des deux ne change l'autorité métier.
## Navigation

La sidebar doit être une **carte des capacités**.

Elle ne doit pas être une projection du nombre de runtimes.

Un domaine peut contenir :

- un cockpit de pilotage ;
- plusieurs workspaces d'action ;
- des Entity 360 ;
- des routes Legacy temporaires tant que leur absorption n'est pas prouvée.

Pour **Opérations**, la navigation est volontairement plus stricte : seuls les cockpits et workspaces d'exécution y sont exposés. Les écrans de configuration sont parentés à leur domaine propriétaire et ne sont pas dupliqués dans Opérations.

## Contrat front

`cockpit-pattern.js` définit les blocs de présentation autorisés :

- `situation`
- `flow`
- `decisions`
- `exceptions`
- `drilldowns`
- `history`

Un domaine peut laisser un bloc vide. Aucun bloc n'est rempli par déduction générique.

## Séquencement

### Lot CP-1 — Fondation

- contrat commun ;
- décorateur de surfaces ;
- thème Legacy cockpit commun ;
- branchement Pilotage / Commerce / Opérations / Finance.

### Lot CP-2 — Navigation

- restaurer la carte complète des capacités ;
- empêcher une policy secondaire de ré-écraser la navigation riche ;
- distinguer cockpit, workspace et 360.

### Lot CP-3 — Catalogue / Marchés

- relier explicitement Import → Catalogue global → Prêts à vendre marché ;
- conserver les retours contextuels de lot.

### Lot CP-4 — Legacy restant

Auditer puis absorber, sans masquer avant preuve :

- Sales ;
- Santé ;
- Suppliers ;
- Transit ;
- Douane ;
- Shared carts ;
- Simulator.

## Invariant final

> **Une vérité métier, plusieurs vues de décision ; une grammaire de cockpit commune ; un langage visuel Legacy ; aucune duplication de logique métier.**
