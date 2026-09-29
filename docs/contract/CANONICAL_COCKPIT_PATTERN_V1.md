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

Le cockpit Opérations expose :

- état d'exécution ;
- flux commande → colis → transit → relais ;
- files de travail ;
- retards/incidents ;
- drill-down vers Hub / Relais et Expéditions & Douane.

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

Le langage graphique commun est celui du Back Office Legacy :

- fond `#f8f9fa` / surfaces blanches ;
- bordures fines grises ;
- très peu d'ombres ;
- orange Komerce pour rythme/navigation/action ;
- vert uniquement pour un état réellement positif ;
- orange pour attente/action ;
- rouge pour blocage/critique ;
- bleu uniquement pour information/contextualisation ;
- titres anthracite, légèrement renforcés, jamais lourds ;
- densité de données supérieure aux premières maquettes Canonical.

Le Legacy fournit la **lisibilité**, pas l'architecture.

## Navigation

La sidebar doit être une **carte des capacités**.

Elle ne doit pas être une projection du nombre de runtimes.

Un domaine peut contenir :

- un cockpit de pilotage ;
- plusieurs workspaces d'action ;
- des Entity 360 ;
- des routes Legacy temporaires tant que leur absorption n'est pas prouvée.

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
