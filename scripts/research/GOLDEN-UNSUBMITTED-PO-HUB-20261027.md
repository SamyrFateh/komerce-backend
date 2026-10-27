# R&D — Étalonnage négatif PO non soumise (27 octobre 2026)

**État : protocole versionné ; le nouveau run CI n'est pas encore vérifié.** Le succès du Golden double du run #40480564524 ne vaut pas exécution de cette nouvelle perturbation.

## Intention métier
Le Golden reste identique sauf la forme de PO : regroupée (en-tête sans commande, statut draft) versus historique (en-tête lié à la commande, statut pending). Avant la confirmation, le checkpoint relit en PostgreSQL la PO et sa ligne, confirme l'absence de référence supplier_order_id, d'exécution fournisseur enregistrée et de paiement fournisseur. Les faits sont émis dans pre_submission.

## Contre-épreuve de réception Hub
Pour chaque PO non confirmée, le test appelle le véritable service receiveSupplierPackage dans une transaction PostgreSQL explicitement rollbackée, et capture le verdict Hub, la raison de quarantaine et le nombre d'allocations. Il vérifie ensuite qu'aucune allocation du test n'a survécu. Ces faits sont émis dans pre_submission_hub_probe.

Le comparateur conserve la comparaison précédente sur quatre checkpoints FINANCIAL_CLOSE_MATCHED. Il compare séparément les réponses Hub anticipées, sans exiger artificiellement l'égalité des statuts techniques draft et pending et sans qualifier automatiquement toute différence de bug.

## Hypothèse en cours d'étalonnage
Dans services/hub-physical-identity.js, la voie PO regroupée refuse explicitement draft avec HUB_PURCHASE_ORDER_NOT_SUBMITTED. La voie historique, via resolvePurchaseSnapshot, contrôle l'identité sans rejeter explicitement le statut pending au même endroit. Cette observation statique ne prouve ni un bug en production, ni que pending est sémantiquement non soumis, ni l'absence d'une autre garde.

Les contre-épreuves pures refusent une PO de forme déclarée incorrecte, un mauvais ordre ou item, une référence fournisseur anticipée, une exécution ou un paiement fournisseur anticipé, une preuve Hub absente et même deux Goldens identiquement incomplets dans une des neuf catégories.

## Critère GO
Exiger un run PostgreSQL 16 vérifié avec retour Hub observé et rollback prouvé, puis arbitrage de la doctrine historique pending. Seulement ensuite envisager une PR métier minimale. Aucun changement de main, staging, produit, paiement réel ou environnement fournisseur dans ce protocole.

Run nominal précédent : https://github.com/SamyrFateh/komerce-backend/actions/runs/40480564524

## Résultat vérifié — GitHub Actions #40495565489

**Workflow vert** : 30/30 tests purs, deux Goldens PostgreSQL (regroupée et historique), comparateur, archive JSON. Chaque exécution termine toujours sur FINANCIAL_CLOSE_MATCHED avec neuf catégories d'identité, quatre checkpoints et la garde SQL SKU 23514.

Sur la même intention *avant confirmation* et sans supplier_order_id, supplier_execution_orders ou supplier_execution_payments :

| PO persistée | Réception du vrai service Hub dans une transaction annulée | Allocations avant ROLLBACK |
| --- | --- | --- |
| Regroupée draft | QUARANTINED — HUB_PURCHASE_ORDER_NOT_SUBMITTED | 0 |
| Historique pending | RECEIVED — aucune erreur | 1 |

La sonde vérifie zéro allocation résiduelle après ROLLBACK. Comparaison finale nominale : NO_ASYMMETRY_OBSERVED. Sonde pré-soumission : EARLY_HUB_RECEIPT_ASYMMETRY_HYPOTHESIS.

**Classification : divergence métier reproduite dans PostgreSQL éphémère, bug de production NON confirmé.** Point d'arbitrage : pending historique signifie-t-il « commande réellement soumise » ou « demande créée, soumission incertaine » ? Ce résultat n'implique pas une commande fournisseur effectivement non transmise hors Komerce, ni une régression constatée sur staging.

Preuve : https://github.com/SamyrFateh/komerce-backend/actions/runs/40495565489

