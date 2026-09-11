# DASHBOARD DECISION VISUAL V1.1 — Scope

## Objectif

Implémenter la première tranche de la doctrine décisionnelle sans modifier les owners métier ni les frontières d'autorisation.

## Inclus

- grammaire visuelle partagée de décision ;
- composants présentationnels réutilisables ;
- Pilotage comme première surface migrée ;
- réutilisation stricte des payloads serveur existants ;
- tests unitaires des primitives et projections ;
- trace des gaps non encore alimentés.

## Hors scope

- création d'un nouveau moteur d'alertes ;
- recalcul de KPI côté navigateur ;
- modification de DashboardSchema V1 ;
- modification des guards / rôles / Market IDs ;
- remplissage artificiel des chiffres des mocks ;
- migration simultanée de tous les dashboards.

## Critère de réussite

Pilotage doit exprimer la nouvelle hiérarchie visuelle avec des informations prouvées, sans deuxième fetch, sans perte du scope serveur et sans casser les surfaces Canonical non migrées.
