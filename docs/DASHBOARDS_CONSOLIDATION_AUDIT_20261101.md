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
| 3 | Hub & Relais vs Hub Live / Relais Live | `operations-workspace.js`, `relay-live.js` | **Partiel** : Relais Live exécute encaisser / réceptionner / remettre (mêmes routes gardées que Hub & Relais, rôle Agent Relais couvert). Anciens écrans CONSERVÉS tant que la recette métier n'a pas prouvé la continuité (redirection à faire ensuite). | unit + `relais-live-execution.spec.js` 8/8 |
| 4 | Cash & dépôts → Relais Live | `finance-accounting-workspace.js` réutilisé | **Partiel** : onglet Cash & dépôts hébergé dans Relais Live avec les mêmes contrôles (dépôts, garde, vérification, litige) ; l'ancienne entrée Comptabilité reste, en onglet de transition. Retrait de l'ancien écran : après recette. | `relais-live-execution.spec.js`, `finance-accounting-workspace.spec.js` |
| 5 | Finance / Comptabilité | `finance*.js`, `services/dashboard-finance-canonical.js`, `dashboard-metrics/costing.js` | **Partiel** : l'écart « 12 à finaliser / 0 sur 11 finalisées » est **expliqué et corrigé** : la liste « à établir » compte les commandes non annulées de la période, payées ou non (`getCmdsCoutIncompletCount`), alors que la marge finalisée ne porte que sur les commandes **payées** (`getMarginScope`). Libellés rendus explicites (« coûts à établir », « N payées finalisées ») + total non plafonné `incomplete_cost_orders_total`. La marge finalisée n'est déjà jamais affichée si absente (« — »). **Ajouté** : section Journal de la Vue Finance (états planned/committed/observed/settled, montants natifs, EUR, restant fournisseur natif), alimentée par la projection du journal. **Non fait** : détail N1/N2/N3 séparé, retrait des listes de rapprochement détaillées. | unit |
| 5b | Comptabilité | `finance-journal-workspace.js`, `routes/admin-finance-accounting-workspace.js`, `services/financial-journal*.js`, migration 360 | **Fait (journal)** : onglets Synthèse / Journal / Rapprochements / Pièces + Cash & dépôts (transition). Journal canonique de mouvements (montant natif, taux historiques, état planned→committed→observed→settled→reversed, provenance, liens commande/PO/expédition/colis/fournisseur/relais, pièces), projecteurs idempotents, EUR via fx-authority (jamais estimé), réconciliation avec les sources métier et l'agrégat dashboard. **Ce n'est pas une comptabilité en partie double.** | PG `financial-journal-postgres` (10 tests), unit, `finance-journal-workspace.spec.js` 6/6 (1440/390, 3 rôles) |
| 6 | Certification | — | CI PR #3249 vert au commit `bdd4b2d`. Captures Chromium: voir rapport final. | CI + specs |

## Risques / limites
- Aucun GO global. Restent : indicateurs Commerce supplémentaires, historique des transitions dans le panneau Opérations (donnée non exposée par le payload ; Order 360 porte l'historique complet), détail N1/N2/N3, alerte planifiée sur écarts du journal (`conflicts`, `eur_unavailable`, aujourd'hui en log + onglet Rapprochements), retrait des anciens écrans après recette.
- Filtre marché d'À traiter en vue globale : navigation `?market=` (le payload global ne porte pas le marché par signal).
- Fixtures `AUDIT-ND5VE6` / `K-GOLDEN` non touchées.

## Matrice de couverture Hub & Relais (lots 3 et 4)

| Fonction existante | Écran actuel | Propriétaire cible | État |
|---|---|---|---|
| Commander (mark-ordered) | Hub & Relais | Achats | présent, à transférer à Achats ; non retiré |
| Réception fournisseur Hub, approvisionnement, boxes→expédition, stock, répartition | Hub live · Exécution | Hub Live | fonctionnel (Hub P0) |
| Expédier colis (`parcels/:ref/ship`) | Hub & Relais | Hub Live | doublon à rapprocher : non retiré |
| Encaisser cash, Réceptionner, Remettre au client | Hub & Relais | Relais Live | **disponible dans Relais Live** (mêmes routes) ; ancien écran conservé |
| Dépôts / garde / pertes / contrôle indépendant | Comptabilité · Cash & dépôts | Relais Live | **hébergé** dans Relais Live ; ancien onglet conservé (transition) |
| Politique de contrôle cash marché | `market-cash-control.js` | Marché | inchangé |

Aucun ancien écran n'est retiré : redirection seulement après la recette métier de l'utilisateur.


## Lot suivant (2026-11-01 soir)
- Alerte écarts du journal : signal `financial_journal_gap` (par marché, idempotent, auto-résolu). PG : `financial-journal-gap-signal-postgres`.
- Opérations : historique des 6 dernières transitions (`order_status_history`) dans le panneau latéral, projeté côté serveur et borné au marché ; « prochaine action » = responsable de la cause (déjà affiché).
- Finance / Comptabilité : niveaux N1/N2/N3 (N3 non alimenté, N2 = hypothèse de classement).
- Commerce : encaissé net (journal) et part des lignes produit.

## Retrait des anciens écrans (2026-11-02)

- **Hub & Relais** (`/admin/workspaces/operations`) : retiré de la navigation. L'URL historique redirige vers `/admin/hub-live?view=execute` (agent_relais : `/admin/relais-live?view=execute`) en conservant `?market`.
- **Cash & dépôts** : onglet retiré de Comptabilité ; le module vit dans Relais live (onglet « Cash & dépôts »).
- **Accès conservés** : `market_operator` → « Hub · Exécution » et « Relais · Cash & dépôts » (domaine Opérations, lecture) ; `finance` → « Cash & dépôts » (domaine Finance, module cash seul, sans file opérationnelle) ; `agent_hub` / `agent_relais` atterrissent sur leur Live.
- **Sécurité** : `agent_relais` ne lit plus le journal financier (403 sur `/journal/*`) et n'a plus Comptabilité dans sa navigation.
- Moteur `operations-workspace.js` conservé (modes `execution` et `relay-execution`) ; le mode lecture seule historique n'a plus de point d'entrée.

