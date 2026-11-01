# Contrat — rapprochement N1 des expéditions internationales (lot 355)

## Propriété des faits et périmètre
- **Source** : `international_shipments.freight_invoice_kmf` (facture réelle), `international_shipment_charges` (charges et avoirs justifiés). Aucun tarif prévisionnel ni estimation N3 ne peut devenir une charge réelle.
- **Cible** : `order_item_real_cost_allocations`, types N1 `freight`, `port_transitaire`, `local_distribution`. Le service propriétaire des écritures appartient à **economic-engine**.
- **Filiation** : `international_n1_allocation_links` identifie chaque allocation par expédition, type, nature de frais, colis et ligne ; les allocations issues des dossiers douaniers gardent leur propre `shipment_id`. Aucune réécriture des documents sources ni du moteur de prix.

## Exécution
Un administrateur habilité, avec autorité marché serveur, lance **Rapprocher les coûts réels (N1)** depuis le dossier de transport lié à sa douane. La transaction vérifie le marché, les colis, la facture de fret, les frais et avoirs, ainsi que les écritures douane et leur preuve. Elle remplace seulement ses propres allocations, conserve le coût au centime, inscrit une empreinte de documents et actualise la projection de marge canonique si celle-ci est activée. Rejouer les mêmes preuves est sans effet.

## Règles fail-closed
1. Une facture fret non nulle en transport **et** un fret réel positif déjà porté par la douane : refus du rapprochement. La douane n'est pas supprimée ni réécrite.
2. Même catégorie de frais ou même preuve présente à la fois dans le journal transport et dans le journal douane : refus jusqu'à clarification et arbitrage de l'unique source autoritaire.
3. Après rapprochement, des triggers empêchent les nouvelles imputations anciennes entrant en doublon avec le coût international.
4. Colis hors marché, ligne de commande étrangère, total sans porteur, crédit supérieur aux frais ou erreur d'arrondi : transaction annulée intégralement.
5. Maritime : volume Hub observé, ou répartition égale signalée comme faible confiance si tout volume manque. Frais annexes : répartition égale documentée par colis ; détail article par quantité.
6. Aérien : fret **non imputable tant que le poids taxable contractuel n'est pas calibré**. Aucun coefficient arbitraire.
7. Fret réel inconnu (NULL) avec frais documentés : rapprochement **partiel**, jamais un fret réel à zéro. Aucun fait réel : rapprochement refusé. Une nouvelle facture ou modification de dossier rend le rapprochement **à actualiser** dans l'interface ; la réexécution refait les quotes-parts depuis les faits.

## Sortie affichée
Montants N1 effectivement ventilés : fret, frais d'arrivée/port-transitaire, transport local vers relais ; statut *non rapproché*, *à actualiser* ou *rapproché*. Ce sont des coûts réels, pas un second prix de vente.

## Gates
Tests Jest sécurité, conservation, avoirs et rejouabilité ; migration PostgreSQL 16 jetable et contraintes SQL ; Required verdict et tests Chromium. Déploiement et activation uniquement lorsque les gates sont verts, sans désactivation.
