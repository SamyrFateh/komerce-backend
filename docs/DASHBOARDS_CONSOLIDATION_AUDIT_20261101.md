# Refonte consolidée des dashboards — audit & état (2026-11-01)

Doctrine : chaque métier exécute dans son espace ; les dashboards transversaux consolident et supervisent.
Branche `feat/dashboards-consolidation-20261101` (empilée sur #3248). Aucun merge/déploiement.

## Matrice (statut honnête)

| Lot | Surface | Fichiers | Statut | Preuve |
|---|---|---|---|---|
| 2A | `/admin/action-center` | `action-center.js`, CSS finish-polish | **Fait** : 2 colonnes Urgent/critique vs Avertissements, compteurs, filtre domaine (client) + marché (navigation serveur), ligne compacte (réf., domaine, cause, âge, prochaine action, « Traiter »), groupement dépliable par nature, Vu/Reporter/Résolu repliés sous « ⋯ », message « se ferme automatiquement » retiré. Auto-clôture + historique : déjà côté serveur (`auto_resolves`), inchangé. | unit + `dashboards-consolidation.spec.js` 1440/390 |
| 2B | `/admin/commerce` | `commerce-decision.js` | **Partiel** : « Dernières commandes » retiré. **Manquant** : CA (définition comptable), montant encaissé, panier moyen, comparaison marchés, top produits contributeurs, distinction cohortes/statuts → nécessite l'extension du payload backend `routes/dashboard-commerce` (non faite, pas de chiffres inventés). | unit |
| 2C | `/admin/clients` | `client-index.js`, `entity-360.css` | **Fait** : téléphone masqué par défaut, bouton œil discret (aria-label dynamique), largeur de colonne constante, permissions inchangées. | unit + spec 1440/390 |
| 2D | `/admin/operations` | `operations-decision.js`, CSS control-board | **Fait** : blocs Cash à confirmer / À commander / Attente réception Hub / Préparer le colis supprimés (+ helpers morts) ; clic dossier → panneau latéral (bottom-sheet mobile) : réf., étape, objet, causes/responsable, lineage PO/HUB/colis, lien Order 360, fermeture. **Reste** : historique des transitions et « prochaine action possible » filtrée par rôle (donnée non exposée par le payload actuel). | unit + `operations-control-board.spec.js` 13/13 |
| 3 | Hub & Relais vs Hub Live / Relais Live | `operations-workspace.js` (exécution Hub P0 déjà dans Hub Live), `hub-live.js` | **Non migré** : l'ancien écran n'est PAS retiré ; la matrice fonction par fonction n'est pas prouvée. Le Relais Live n'a pas d'équivalent exécutable complet. | — |
| 4 | Cash & dépôts → Relais Live | `market-cash-control.js`, `routes/market-delegation-cash-control.js` | **Non fait** (déplacement + projection comptable à concevoir ; risque de régression financière). | — |
| 5 | Finance / Comptabilité | `finance*.js`, `finance-accounting-workspace.js` | **Non fait** (EUR pivot/FX, coûts planned/committed/observed, onglets Synthèse/Journal/Rapprochements/Pièces). Question ouverte : « 12 à finaliser, 0/11 finalisées » (dénominateurs/dates de référence) à auditer. | — |
| 6 | Certification | — | Partielle (lots 2A/2C/2D). | — |

## Risques / limites
- Aucune GO globale : les lots 2B (indicateurs), 3, 4, 5 restent à faire.
- Filtre marché d'À traiter en vue globale : navigation `?market=` (le payload global ne porte pas le marché par signal).
- Fixtures `AUDIT-ND5VE6` / `K-GOLDEN` non touchées.
