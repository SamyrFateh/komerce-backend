# Refonte consolidée des dashboards — audit & état (2026-11-01)

Doctrine : chaque métier exécute dans son espace ; les dashboards transversaux consolident et supervisent.
Branche `feat/dashboards-consolidation-20261101` (empilée sur #3248). Aucun merge/déploiement.

## Matrice (statut honnête)

| Lot | Surface | Fichiers | Statut | Preuve |
|---|---|---|---|---|
| 2A | `/admin/action-center` | `action-center.js`, CSS finish-polish | **Fait** : 2 colonnes Urgent/critique vs Avertissements, compteurs, filtre domaine (client) + marché (navigation serveur), ligne compacte (réf., domaine, cause, âge, prochaine action, « Traiter »), groupement dépliable par nature, Vu/Reporter/Résolu repliés sous « ⋯ », message « se ferme automatiquement » retiré. Auto-clôture + historique : déjà côté serveur (`auto_resolves`), inchangé. | unit + `dashboards-consolidation.spec.js` 1440/390 |
| 2B | `/admin/commerce` | `commerce-decision.js`, `services/dashboard-commerce.js` | **Fait (audit corrigé)** : le payload fournit déjà CA = ventes payées wallet inclus (hors annulées/remboursées), panier moyen, série, répartition marché, top produits, catégories, funnel (créées, payées, expédiées, dispo relais, retirées). Ajouts : « Dernières commandes » retiré, définition du CA affichée en clair ; cohorte (funnel) vs statuts déjà distingués, série clairsemée déjà signalée. **Écart assumé** : pas de « montant encaissé » (le CA n'est pas du cash, cf. Finance) ni de % de contribution par produit (assiette des lignes ≠ CA, risque d'erreur). | unit |
| 2C | `/admin/clients` | `client-index.js`, `entity-360.css` | **Fait** : téléphone masqué par défaut, bouton œil discret (aria-label dynamique), largeur de colonne constante, permissions inchangées. | unit + spec 1440/390 |
| 2D | `/admin/operations` | `operations-decision.js`, CSS control-board | **Fait** : blocs Cash à confirmer / À commander / Attente réception Hub / Préparer le colis supprimés (+ helpers morts) ; clic dossier → panneau latéral (bottom-sheet mobile) : réf., étape, objet, causes/responsable, lineage PO/HUB/colis, lien Order 360, fermeture. **Reste** : historique des transitions et « prochaine action possible » filtrée par rôle (donnée non exposée par le payload actuel). | unit + `operations-control-board.spec.js` 13/13 |
| 3 | Hub & Relais vs Hub Live / Relais Live | `operations-workspace.js` (exécution Hub P0 déjà dans Hub Live), `hub-live.js` | **Non migré** : l'ancien écran n'est PAS retiré ; la matrice fonction par fonction n'est pas prouvée. Le Relais Live n'a pas d'équivalent exécutable complet. | — |
| 4 | Cash & dépôts → Relais Live | `market-cash-control.js`, `routes/market-delegation-cash-control.js` | **Non fait** (déplacement + projection comptable à concevoir ; risque de régression financière). | — |
| 5 | Finance / Comptabilité | `finance*.js`, `services/dashboard-finance-canonical.js`, `dashboard-metrics/costing.js` | **Partiel** : l'écart « 12 à finaliser / 0 sur 11 finalisées » est **expliqué et corrigé** : la liste « à établir » compte les commandes non annulées de la période, payées ou non (`getCmdsCoutIncompletCount`), alors que la marge finalisée ne porte que sur les commandes **payées** (`getMarginScope`). Libellés rendus explicites (« coûts à établir », « N payées finalisées ») + total non plafonné `incomplete_cost_orders_total`. La marge finalisée n'est déjà jamais affichée si absente (« — »). **Non fait** : états de coût planned/committed/observed/disbursed/remaining, agrégation multi-marchés en pivot EUR (données présentes : `orders_fx_snapshot` mig. 315, `fx_authority` 314, mais aucun agrégat Finance ne les consomme), retrait des listes de rapprochement détaillées. | unit |
| 5b | Comptabilité | `finance-accounting-workspace.js` | **Non fait** : l'écran actuel est « Cash & dépôts » (grand livre de garde `287_cash_custody_ledger`, pas une comptabilité en partie double). Onglets Synthèse/Journal/Rapprochements/Pièces absents ; **aucun grand livre en partie double n'existe** : à ne pas annoncer. Prérequis : journal unifié lié commande/PO/expédition/colis/fournisseur/relais/pièce. | — |
| 6 | Certification | — | Partielle (lots 2A/2C/2D). | — |

## Risques / limites
- Aucune GO globale : les lots 2B (indicateurs), 3, 4, 5 restent à faire.
- Filtre marché d'À traiter en vue globale : navigation `?market=` (le payload global ne porte pas le marché par signal).
- Fixtures `AUDIT-ND5VE6` / `K-GOLDEN` non touchées.

## Matrice de couverture Hub & Relais (lots 3 et 4)

| Fonction existante | Écran actuel | Propriétaire cible | État | Preuve / blocage |
|---|---|---|---|---|
| Commander (mark-ordered) | Hub & Relais `orders/:ref/mark-ordered` | Achats (chemin d'achat) | présent, à transférer | non retiré |
| Réception fournisseur Hub, approvisionnement, boxes→expédition, stock à affecter, répartition | Hub live · Exécution (même fichier `operations-workspace.js`, mode `execution`) | Hub Live | **déjà fonctionnel** (Hub P0) | PG16 + Playwright |
| Expédier colis (`parcels/:ref/ship`) | Hub & Relais | Hub Live | présent, doublon à rapprocher | à prouver |
| Encaisser cash (`orders/:ref/confirm-cash`) | Hub & Relais | Relais Live | **manquant dans Relais Live** (lecture seule `/api/relay/*`) | blocage retrait |
| Réceptionner colis relais (`parcels/:ref/receive`) | Hub & Relais | Relais Live | **manquant** | blocage retrait |
| Remis au client (`parcels/:ref/collect`) | Hub & Relais | Relais Live | **manquant** | blocage retrait |
| Dépôts / garde / pertes / contrôle indépendant (`deposits`, `custody/*`) | Comptabilité · « Cash & dépôts » (`finance-accounting-workspace.js`) | Relais Live | présent mais mal placé ; projection comptable à conserver | risque de régression financière |
| Politique de contrôle cash marché | `market-cash-control.js` (politique, pas l'opérationnel) | Marché (inchangé) | fonctionnel | — |

Conclusion : **Relais Live est en lecture seule**. Retirer Hub & Relais ou Cash & dépôts maintenant casserait Encaisser / Réceptionner / Remettre / dépôts. Ordre sûr : (1) ajouter les actions relais exécutables au Relais Live en réutilisant les mêmes routes, (2) y déplacer Cash & dépôts avec ses contrôles, (3) tests PG + Playwright rôles Agent Relais, (4) seulement alors rediriger les anciens écrans.
