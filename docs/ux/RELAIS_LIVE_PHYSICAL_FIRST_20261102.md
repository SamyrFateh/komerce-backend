# Relais Live — contrat métier « colis physique d'abord » (2026-11-02)

## Symptômes prouvés

Capture /admin/relais-live : tuile « En transit » = 1 alors que 2 cartes de commandes AUDIT-ND5VE6 sont affichées.
Ces valeurs ne portent pas nécessairement sur le même objet : `countRelayParcels`
compte les `parcels` physiques ; `/api/relay/orders` liste des `orders`.
Une commande affichée n'est **pas** une preuve qu'un carton contient tous ses articles.

Capture détail : clic sur `?view=order&order=<uuid>&from=in_transit` => HTTP 500
sur `GET /api/relay/orders/<uuid>?projection=live`, confirmé dans Railway
2026-11-02 11:24 UTC : PostgreSQL `operator does not exist: text = uuid`.
Cause : `o.id = $1::uuid OR o.reference = $1` partage un paramètre au type inféré UUID.
Correctif isolé : `o.reference = $1::text`, test de régression et erreur localisée en UI.

## Source de vérité physique existante

- `hub_physical_units` : unité/carton physique, notamment `MARKET_PARCEL`.
- `hub_physical_unit_placements` : placement des quantités réelles dans l'unité ; exclure `removed_at IS NOT NULL`, les opérations de sortie et les unités en quarantaine.
- `hub_purchase_allocations` : lignage achat → ligne d'achat → ligne commande.
- `international_shipment_hub_units` : un carton → expédition, avec intégrité sur le marché.
- `services/hub-procurement-dossier.js:getTrace` expose la chaîne commande → article → PO → réception → carton → expédition ; ce service et `GET /api/hub/trace` sont réservés au périmètre Hub, **pas** une autorisation pour l'agent relais.
- `parcels` et `parcel_items` portent les objets de distribution/remise au relais. Le pont entre KOM-BOX, expédition et colis remis doit être **persisté et prouvé**, jamais supposé à partir de la référence commande.

## Cible interface Relais Live

Vue opérateur unique, parcours maître de gauche à droite :
1. **Arrivages / Colis** : file des unités physiques attendues, en transit, reçues, disponibles, remises, avec leur relais réel et leur expédition d'origine. Séparer compteurs par unités : expéditions, cartons et colis de remise.
2. **Détail du colis** au clic : carton / numéro / provenance Hub + expédition + état de réception et preuve.
3. **Commandes réellement contenues** (dépliables) : références + destinataires autorisés + état de paiement ; N commandes par unité si preuve physique.
4. **Articles réellement placés / expédiés** par commande : produit, SKU, quantité commandée, quantité placée dans CE carton, quantité reçue et remise si cette preuve existe. Un reliquat non expédié est visible en contexte commande, mais **jamais** présenté comme contenu du carton.
5. **Actions contextuelles** uniquement si transition autorisée : réception, contrôle/écart, cash, remise client, preuve horodatée. Aucune action Hub dans Relais Live.
6. **Incidents et exceptions** uniquement pour écarts bloquants, colis manquant, endommagé, non réconcilié ; liens « À traiter » si action requise.

Si une commande est répartie sur plusieurs cartons, afficher les quantités reçues par carton et la somme réconciliée. Si un carton regroupe plusieurs commandes, montrer les deux sous ce carton. Ne jamais fabriquer les correspondances manquantes.

**Commande locale** : circuit distinct stock local → préparation/disponible relais → retrait avec preuve ; pas de Hub, PO, transitaire ni expédition fictifs.

## API de lecture à créer avant remplacement de la vue

Read-model explicitement scellé au scope autorisé du rôle agent_relais (server-side), market_operator et admin.
Au minimum `GET /api/relay/physical-flow` (liste paginée) et `GET /api/relay/physical-flow/:unitId` (détail) **ou** évolution équivalente documentée des routes canoniques. Inclure les liens vers `parcels` seulement s'ils sont persistés.
Ne pas réutiliser `GET /api/hub/trace` depuis un rôle Relais.
Erreur de projection = « rapprochement physique indisponible », pas 0 colis et pas conversion en liste de commandes.
Préserver le montant cash par devise de marché, sans total KMF agrégé multi-marchés.

## Portes de recette

- PG réel : carton multi-commandes ; commande multi-cartons ; reliquat ; placement retiré/quarantaine ; colis sans lignage ; expédition manquante ; isolation inter-relais et inter-marché ; commande locale sans Hub.
- API : références/UUID et 403/404/500 ; liste lisible malgré détail indisponible ; aucune fuite de contacts ou secrets dans la projection Live.
- Chromium 1440 / 390 : file physique → carton → commandes → articles → preuve réception / remise ; retour, navigation arrière/avant ; affichage des quantités exactes et absence de double comptage.
- Comparaison SQL : compteurs et lignes portent la même unité ; interdit d'annoncer « 1 colis » en affichant deux commandes comme deux colis.
- Pilotage : « À traiter » reçoit uniquement les écarts business actionnables, pas les états nominaux ni les alertes techniques non décisionnelles.

Cette note fige la conception. La branche corrige immédiatement le crash des fiches ; elle **ne revendique pas** encore une projection physique complète ni une recette E2E réelle.
