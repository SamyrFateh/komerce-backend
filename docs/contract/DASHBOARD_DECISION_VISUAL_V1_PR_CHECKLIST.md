# Dashboard Decision Visual V1 — checklist PR

## Règles bloquantes

- [ ] aucune valeur illustrative du mock n'est codée en production ;
- [ ] aucune vérité métier n'est recalculée dans le navigateur ;
- [ ] scope marché résolu avant lecture de données ;
- [ ] donnée manquante affichée comme inconnue / gap, jamais comme zéro ;
- [ ] tendance affichée uniquement si la comparaison est prouvée ;
- [ ] tout CTA visible pointe vers une destination effectivement autorisée ;
- [ ] alertes = projection d'une source serveur, jamais nouveau moteur frontend ;
- [ ] 3 à 4 cartes maximum dans le bandeau de décision ;
- [ ] 4 à 6 KPI clés maximum avant le détail ;
- [ ] représentation choisie selon la forme de la donnée ;
- [ ] fraîcheur, scope et qualité visibles lorsqu'ils existent.

## Preuve par écran

Chaque migration complète la matrice :

`bloc visuel → information → source serveur → scope → représentation → CTA → statut`

Statuts autorisés : `PROVEN`, `PROJECTABLE`, `BACKEND_GAP`, `UI_GAP`, `DEFERRED`.

## Pilotage V1.1

- [x] DecisionStrip basé sur données existantes uniquement.
- [x] KPI canoniques réutilisés.
- [x] `view_blocks` projetés en SummaryCards.
- [x] `economic_flow` projeté en FlowStrip.
- [x] `system_alerts` conservé comme vérité d'alertes.
- [x] `principles` redevient visible.
- [x] `data_quality` et scope projetés dans TrustFooter.
- [x] aucune seconde requête réseau ajoutée par le rendu décisionnel.
- [x] DashboardSchema V1 et renderer V1 laissés intacts pour les écrans non migrés.
