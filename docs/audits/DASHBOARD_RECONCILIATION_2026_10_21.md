# Revue transversale dashboards — reprise 2026-10-21

## Source et statut
Références visuelles : `docs/contract/DASHBOARD_MOCK_TRACE_V1.md` et `docs/visual-references/dashboards/`. Audit historique : `docs/audits/DASHBOARD_MOCK_CONFORMANCE_AUDIT_V1.md` (historique, non une preuve live actuelle). Ce relevé est une revue de code et des contrats, **pas** une recette navigateur authentifiée.

## Arbitrage Finance validé
Vue principale = CA encaissé / coûts directement engagés pour les commandes / marge réelle finalisée. Pas de panneau d'écarts, de complétude, ni de coûts à établir. Analyse et collecte dans les ateliers responsables. **Écart de contrat à résoudre** : le KPI serveur existant `cout_reel` additionne des coûts justifiés/constatés ; il n'est pas une source prouvée de tous les coûts *engagés*, en particulier ceux non encore constatés. Le lot UI utilise temporairement le libellé honnête « Coûts constatés » : il ne prétend pas satisfaire entièrement la nouvelle définition du KPI « Coûts engagés ». Ne jamais fabriquer ce montant côté navigateur. Un agrégat serveur canonique distinct et des règles anti-double compte sont requis avant ce renommage.

## Matrice de passage / conformité
| Surface | Lecture actuelle et delta à traiter | Statut de cette passe |
|---|---|---|
| Opérations | Synthèse 6 phases (#2771), tour de contrôle 9 étapes conservée ; vérifier densité et navigation par rôle en navigateur | Code existant ; recette live requise |
| Commerce | 4 KPI, funnel, top 5 produits et catégories (#2772) ; graphiques temporels/ventilation marchés en attente d'agrégats backend | Code existant ; recette live requise |
| Finance | Réduire la synthèse à 3 KPI ; écarter panneaux d'écarts et de complétude ; clarifier la différence constaté/engagé | Changement UI proposé ; backend gap confirmé |
| Pilotage | Le signal « problèmes costing » pointait vers un bloc Finance supprimé ; réorienter vers Opérations sans prétendre corriger les coûts | Navigation corrigée ; cible dossier précis à vérifier |
| Sourcing Live | L'audit historique signale une divergence structurelle technique / pilotage métier ; ne pas ajouter stock et délais fictifs | Revue métier et sources requises |
| Hub Live / Relais Live | Examiner alertes de traitement, preuves scans, cash, files et scope rôle ; ne pas fabriquer stock/seuils | Recette live requise |
| Marchés / Catalogue pays / Expéditions et Douane | Respecter le scope marché ; examiner liens, densité, signaux réels ; aucune métrique de conversion sans données de visites | Recette live requise |

## Gates d'acceptation
1. Contrat par bloc : `bloc → indicateur → source backend → périmètre → action → rôle → preuve`.
2. Un zéro confirmé n'est ni NULL ni absence de donnée ; estimé/engagé/constaté/finalisé restent distincts.
3. Séparer RCT1 de réel ; aucun agrégat client de substitution.
4. Gate CI, tests visuels desktop/mobile et écran déployé vérifiés séparément ; PASS technique ≠ recette métier.
5. Aucun RESET/purge, paiement réel ni mutation des données de staging dans cette passe.
