# #5315 — L2 : registre des KPI, contrat de convergence V1 (candidat)
Base relue : `84f8024d56be343dfb7e06850bfac7f5d3c0c098`. Ce registre décrit les autorités et les écarts, pas une certification de production ni une nouvelle doctrine. Les mocks ECO V7/V6 et Hub restent inchangés. Le nombre final de dashboards relève du mock L3.

## Règles de comparaison
Un KPI est identifié par (id métier, population, événement/date, bornes, scope serveur, état de preuve, devise et politique FX). Identité égale => même service et même montant au centime ; identités différentes => libellés différents, aucune égalité forcée.
Admin global READ, ACT explicite ; responsable marché limité au marché autorisé. Exclure les simulations des faits réels ; recette séparée et identifiée. Devise native marché, EUR groupe via fx-authority et snapshots ; inconnu = NULL avec couverture, pas zéro. KMF reste base de calcul historique et exception facture Hub V1, pas devise d'affichage universelle.
Commerce/Finance : fenêtres civiles existantes pour leurs cohortes ; ECO : mois UTC selon doctrine 25/11, ne pas les rendre interchangeables. Bornes explicites et demi-ouvertes pour nouvelles projections ; migration des bornes historiques avec preuve aux frontières.

## Registre de convergence
Statuts : PRESENT = source statique identifiée ; PARTIAL = projection existante mais non décisionnelle/écart connu ; TARGET = cible non certifiée. Les clés ci-dessous sont les identités proposées, pas une affirmation de clés API déjà déployées.

| Identité proposée | Définition / population et date | Autorité actuelle ou cible | Usage décisionnel / statut |
|---|---|---|---|
| commerce.orders_created | Commandes créées dans la période, tous états, date création | dashboard-metrics/control-tower#getCmdsCreees | Commerce, funnel ; PRESENT |
| commerce.paid_sales_wallet_included | Commandes actuellement payées, hors annulées/remboursées ; total + wallet appliqué, remise déjà incluse ; date création | dashboard-commerce#getCommercePaidSales | Commerce, demande ; PRESENT ; renommer clé ca_encaisse |
| commerce.paid_order_nonwallet | Même population payée, total hors avoir ; date création, pas date cash | dashboard-metrics/control-tower#getCAEncaisse | Diagnostic/cohorte commerciale ; PRESENT ; ne pas appeler encaissé |
| commerce.product_line_sales | Somme prix ligne × quantité des commandes payées éligibles, date création ; avant ventilation des remises commande | dashboard-commerce#getTopProducts/getCategoryPerformance | Assortiment, part produit sur total lignes ; PARTIAL ; jamais CA reconnu |
| finance.customer_receipts | Encaissements non-wallet attestés, date paiement prouvée, état réglé | financial-journal-projectors#projectOrderPayments + reporting | Finance/Comptabilité ; PARTIAL : fallback date création et snapshot wallet à vérifier |
| finance.cash_refunds | Remboursements monétaires confirmés, date confirmation ; exclure avoir magasin et pending | refunds + journal financier, projection spécialisée | Finance ; TARGET : journal agrégé ne sépare pas correctement tous les modes |
| finance.net_customer_cash | Encaissements attestés − remboursements monétaires confirmés ; même fenêtre de flux | Source finance ci-dessus, pas SQL Commerce parallèle | Finance, lecture secondaire Commerce ; PARTIAL : getCollectedFromJournal retient tout non-reversed, dont committed et avoir |
| finance.refunds_confirmed_all_methods | Remboursements confirmés tous modes, date completed_at, liaison commande origine | dashboard-finance-canonical#getRefunds | Suivi SAV/Finance ; PRESENT ; distinguer cash |
| finance.supplier_commitment_and_payment | Engagement fournisseur, paiement observé et règlement justifié, états distincts ; reste dû par devise, sans addition du prévu et du réglé | financial-journal-projectors, financial-journal-reporting | Finance/Comptabilité ; PARTIAL : rapprochement source requis |
| eco.shipments_received | Expéditions reçues au relais avec attestation, COMBOX, unités, poids/volume documentés ; mois réception physique | economic-cost-center-read-model#loadShipmentActivity | ECO Activité / Direction, opérations ; PRESENT, pas une vente |
| eco.shipment_logistics_cost | Frais de transport documentés et statut clôture financière, cohortes mois réception, charges tardives exclues des observations rapprochées | economic-cost-center-read-model#shipmentActivity | ECO Activité ; PARTIAL : sous-total ≠ coût complet |
| eco.purchase_transport_multiplier | Ratio sommes (achats rapprochés + transport rapproché) / achats rapprochés, mêmes expéditions, achat > 0 | economic-cost-center-read-model#shipmentActivity/observedProfitability | Observation ECO ; PARTIAL ; pas le coefficient complet |
| eco.sku_market_rail_landed_cost | Somme coûts applicables rapprochés / quantités couvertes, SKU × marché × rail, lots local stock distincts des expéditions | cost-allocation/product-margin-steering | Prix & économie ; PARTIAL : couverture/échantillon/statut visibles |
| eco.sku_market_rail_observed_multiplier | Coûts rapprochés / achats réels mêmes lignes ; observation n'autorise pas un prix | cost-allocation/product-margin-steering#observed_multiplier | Prix & économie ; PARTIAL : seuil 3 actuel distinct de politique retrait |
| eco.unit_variable_floor | Prix net couvrant toutes charges variables applicables et frais proportionnels au prix ; garde versionnée avant vente | moteur économique / politique prix | Prix & économie ; TARGET : pas de substitution du ratio achat-transport |
| eco.recognized_net_sales | Ventes des unités remises avec preuve, net remises, wallet inclus, moins remboursements confirmés du mois ; UTC | economic-cost-center-read-model#loadPeriodRecognitionEvidence/projectGroupPeriodResult | Rentabilité / Direction ; PARTIAL : groupe et couverture explicite |
| eco.recognized_variable_cost | Coûts applicables des unités remises + pertes documentées sans double compte ; même fenêtre de reconnaissance | economic-cost-center-read-model#projectGroupPeriodResult | Rentabilité ; PARTIAL : D02/D03, preuve par ligne et risque |
| eco.contribution | Ventes nettes reconnues − coûts variables reconnus | même résultat ECO | Direction/Rentabilité ; PARTIAL ; aucune marge legacy substituée |
| eco.fixed_recognized | Charges fixes constatées sur leur période économique, groupe source une fois, marché quote-part rapprochée | pricing-period-structure#computePeriodStructureTruth | Rentabilité ; PARTIAL : pas budget, pas paiement, pas CDR article |
| eco.period_result | Contribution − charges fixes ; preuve complète puis clôture Direction ; réouverture si preuves changent | economic-cost-center-read-model#projectGroupPeriodResult/closeGroupPeriod | Direction ; PARTIAL : résultat groupe KMF actuel, EUR et marché à converger |
| eco.budget_commitment | Budget révisé et engagements restants, EUR figé ouverture ; pas dépense réalisée | economic-cost-center-read-model#budgetSummary/commitmentSummary | Centres de coûts ; PRESENT |
| eco.hub_internal_balance | Facture figée, créance Hub = dette marché, zéro après règlement attesté ; écart tardif non facturé séparé | hub-internal-invoice-service / market-delegation-cost-statement-service (#5321 candidat) | Finance/Comptabilité ; PARTIAL, ne pas doubler charge source |
| commerce.local_active_price | Prix commercial natif autorisé, marché/variante résolus serveur, LOCAL_ACTIVE seul | market-local-price-resolution-service | Commerce / Catalogue ; PRESENT, aucune écriture du moteur économique |

## Écarts et ordre du lot
1. Dictionnaire IDs, libellés et fenêtres : même clé ca_encaisse sur Commerce et métrique historique avec base différente ; migrer consommateurs + contrats, aucun alias ambigu.
2. Journal : getCollectedFromJournal filtre state !== reversed et inclut les remboursements pending/committed et store_credit ; paiement peut utiliser created_at faute de preuve. Projeter cash réellement attesté, séparer remboursements monétaires et avoirs, documenter rapprochement et FX. Vérifier snapshot marché vs wallet. Ne pas corriger le journal par estimation.
3. Dédoublonner marges : dashboard-metrics/costing#getMargeConsolidee et SQL par produit/trend de dashboard-finance-canonical et dashboard-commerce sont des cohortes historiques de commande, pas le résultat mensuel ECO. Identifier les consommateurs utiles, les nommer honnêtement, retirer comme KPI direction seulement après parité avec les mesures requises. Source économique unique pour contribution et résultat.
4. Mettre à niveau projection EUR groupe et devise marché, statut incomplet et bornes ; conserver observations/ratios distincts de plancher et politique de retrait. Le prix client reste LOCAL_ACTIVE.
5. Tests table-driven : même ID + mêmes bornes/scope => centimes égaux ; commande avec wallet, partiels/refund/avoir, événements de mois différents, zéro connu/inconnu, mix devises, FX manquant, charge tardive, marchés isolés, simulation exclue. API + PG puis Chromium aux trois résolutions. Mock L3 valide missions, navigation et choix des KPI avant refonte.

## Sources versionnées
- docs/doctrine/DOCTRINE_CENTRES_COUTS_V1.md (25/11), docs/doctrine/DOCTRINE_MUTUALISATION_HUB.md
- docs/FINANCIAL_JOURNAL_CONTRACT.md ; docs/contract/DASHBOARDS_CONTRACTS_0C.md ; docs/contract/DASHBOARD_FINANCE_2F.md (historique, A1 et ECO prévalent sur règles incompatibles)
- services/dashboard-commerce.js, services/dashboard-pilotage-market.js, services/dashboard-finance-canonical.js, services/dashboard-metrics/control-tower.js, services/dashboard-metrics/costing.js
- services/financial-journal-projectors.js, services/financial-journal-reporting.js, services/economic-cost-center-read-model.js, services/pricing-period-structure.js, services/cost-allocation/product-margin-steering.js, services/market-local-price-resolution-service.js
- #5315 ; #5317–#5320 fusionnées ; #5321 en CI.

Ce candidat couvre les KPI économiques et financiers prioritaires de L2 ; l'inventaire détaillé des KPI opérationnels, délais/SLA, clients et signaux doit être complété avant gel global. Aucune modification runtime.
