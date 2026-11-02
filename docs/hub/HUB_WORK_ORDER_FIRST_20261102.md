# Hub Live — Dossier commande, parcours Work (2 novembre 2026)

## Décision et delta réel
La v3 précédente ouvrait un tableau d'approvisionnement avec une PO comme racine. Ce n'est pas le parcours validé dans Work. La racine UI est la commande client d'import, dont on déroule les articles, les lignes d'achat/PO indépendantes, les réceptions prouvées, le colis client, les cartons de transport, et l'expédition. La supervision reste dans Vue opérations ; l'exécution physique dans Hub Live.

## Projection métier et garde-fous
- `orders[]` : commandes actives et articles explicitement `fulfillment_source='IMPORT'` (même avant la première ligne d'achat), issus exclusivement des tables orders/order_items.
- `needs[]` : besoins d'achat ouverts qui restent associés à order_item_id et order_id, jamais assimilés à une PO existante.
- `purchase_orders[].lines[]` : chaque ligne identifiée par line_id, order_item_id et order_id. Les PO peuvent mêler plusieurs commandes du même marché. Les quantités confirmées/reçues/manquantes sont l'état réellement renvoyé par le serveur, pas un statut livraison inventé.
- `client_parcels[]` : colis clients de parcels/parcel_items, avec leurs membres order_item_id. Un colis client n'est pas un carton KOM-BOX.
- `boxes[]` : unités physiques Hub de type MARKET_PARCEL et leurs expéditions prouvées. La relation colis client ↔ carton KOM-BOX **n'est pas prouvée par une jointure unique** dans cette projection : ne pas déduire un rattachement automatique.
- `trace?order_id=UUID` : lecture de filiation réelle, des allocations et déplacements physiques ; exclut le double comptage des placements retirés par champ `active`.
- Une commande purement LOCAL_STOCK (ou de provenance inconnue) ne crée jamais de dossier Hub. Une commande mixte peut exposer uniquement ses lignes IMPORT ; le retrait local reste dans le relais.
- Le manque confirmé fournisseur n'est pas encore la décision automatique d'un backorder : incident, rejet fournisseur, remplacement, reliquat, remboursement et redémarrage de cycle doivent rester des mutations explicites et auditables.

## Interface
- Premier niveau : une carte par commande, de la plus récente à la plus ancienne ; état de commande directement issu du serveur, PO fournisseurs multiples et attente fournisseur visibles sans ouvrir d'autres tableaux.
- Une seule ouverture : articles (quantités client), bons fournisseurs, réception physique et contrôle, colis client, cartons de transport et expédition.
- Source autoritative pour actions : Achats fournisseurs émet les PO ; Réceptions encaisse la preuve physique ; le service Hub possède le rattachement carton/expédition. Pas de deuxième route d'écriture introduite.
- Valeurs 'indisponible' si pas de preuve ; aucune clôture de commande dérivée d'un taux de réception.

## Preuves avant GO
1. PostgreSQL : commande avec articles IMPORT visible avant PO, deuxième PO fournisseur sur même commande, réception partielle, article endommagé, reliquat, client parcel distinct du KOM-BOX, local exclu.
2. Chromium desktop 1440 : une commande dépliée comporte les cinq blocs dans le bon ordre, deux PO indépendantes, lien et détail des mouvements prouvés, actions cartons conservées ; aucune écriture pour consultation.
3. Gouvernance : Required verdict vert, backend et rôles, relecture Railway sur SHA réellement déployé.
4. Validation visuelle du mock Work original non réalisée dans cette session ; un test Chromium de structure ne suffit pas à certifier le pixel.

## Hors de ce lot (ne pas proclamer GO global)
Le moteur de backorders et la réconciliation finale 100%/partielle/remboursée/orpheline, la relation directe colis-client ↔ carton de transport si absente, les flux mixtes et les droits avancés restent sujets à preuve backend spécifique.