# Komerce — Chaîne réelle d'expédition internationale V1

## Vérité métier (01/11/2026)
Hub : réception, contrôle, repack, volume final. Remise au transitaire prouvée. Réception transitaire, facture de fret et volume facturable. Départ maritime ou aérien, numéro de conteneur ou de connaissement, ETA. Arrivée. Formalités de douane avec droits/taxes, manutention, stockage, mainlevée prouvée. Transport local. Réception attestée au relais.

## Conception additive
- international_shipments = dossier de transport physique, distinct de customs_shipments, dossier de déclaration douanière.
- international_shipment_parcels = composition de colis de même marché, statut vérifié, appartenance unique.
- international_shipment_events = événements immuables prouvés, acteur et justificatif.
- international_shipment_charges = frais complémentaires réels documentés et idempotents, corrections par crédit. Ce sont des faits sources, non une nouvelle imputation N1 automatique.
- Fret facturé : montant KMF et référence facture sur le dossier transport, jamais recopiés silencieusement dans customs_shipments.freight_kmf.
- Droits et taxes de douane : customs_shipments.customs_paid_kmf reste source canonique. Frais annexes historiques customs_shipment_fees restent en place ; rapprochement par justificatif obligatoire avant toute allocation future.
- Coût prévisionnel : volume m³ × tarif convenu pour lecture. Ne remplace pas la règle contractuelle W/M quand elle s'applique. Coût réel = facture transitaire. Aucun coût inconnu n'est traité comme zéro.

## États et acteurs
hub_ready → handed_over → forwarder_received → in_transit → arrived → customs_released → local_delivery → relay_received.
Chaque transition exige preuve et acteur. Pas de saut. Référence conteneur facultative si le connaissement permet le suivi LCL. ETA révisable avec historique.
- Admin : création, facture de fret, frais, liaison douane, mainlevée.
- Agent hub : remise au transitaire et gestes de transport local/remise relais selon autorisation.
- Agent transitaire : réception, expédition, arrivée et suivi avec capability execution.transit.confirm.
- Market operator : supervision market-scoped, aucun droit de mutation hérité.
Les transitions sont des attestations, sans mutation automatique de colis, paiement ou statut douane. La mainlevée exige le dossier douane lié, la situation de droits connue ET une preuve spécifique.

## Écran
Une page Expéditions & Douane, trois onglets : Transport & fret / Arrivée & douane / Vers les relais. Liste de dossiers, détails, factures, coûts, suivi, pièces et preuves. Le workflow douanier existant demeure dans l'onglet Arrivée ; Hub/Relais demeure le propriétaire des scans physiques.

## Couverture honnête de cette V1
La migration 353 est automatiquement chargée par preDeploy Railway après la fusion. Tests Jest, marché/role et preuve ; Chromium staging authentifié et test PostgreSQL jetable exigés avant verdict GO.

Cette première livraison n'est PAS une certification de rapprochement N1 : aucun poste international_shipment_charges n'est encore écrit dans order_item_real_cost_allocations, précisément pour éviter le double-comptage avant validation. Les frais existants conservent leur propriétaire. Les factures sont référencées, non encore stockées comme pièces binaires. La preuve PDF, la gestion multi-devise/FX snapshot et la ventilation certifiée en N1 réel feront l'objet du lot financier suivant.

## Gates pour la réconciliation
Comparer chacune des factures aux sources douane/fret anciennes ; aucune pièce saisie deux fois. Conserver devise/taux FX à l'opération, allocation maritime selon volume réel ou W/M contractuel, air au poids taxable, frais locaux selon destination/colis, conservation au centime, crédits après clôture et écart prévisionnel/réel. Ne pas utiliser les fixtures AUDIT ou RCT1 comme références commerciales.
