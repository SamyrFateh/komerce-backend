# Commandes G6 du 18 novembre 2026

## Inventaire pour le propriétaire

À exécuter sur le staging après vérification de la cible. Chaque ligne donne l’étape de la commande et, le cas échéant, le statut du PO. Les commandes sans ligne ou sans PO restent visibles. La colonne « campagne_18_11 » identifie le périmètre demandé. Les autres commandes servent au rapprochement.

~~~sql
BEGIN READ ONLY;
WITH membership AS (
  SELECT DISTINCT oi.order_id, pl.purchase_order_id AS po_id
  FROM order_items oi
  JOIN purchase_lines pl ON pl.order_item_id = oi.id
  WHERE pl.cancelled_at IS NULL AND pl.purchase_order_id IS NOT NULL
), peers AS (
  SELECT m.po_id, array_agg(o.reference ORDER BY o.reference) AS commandes_du_po
  FROM membership m JOIN orders o ON o.id = m.order_id
  GROUP BY m.po_id
)
SELECT market.code AS marche, o.reference, o.status AS etape_commande,
       o.payment_mode, o.payment_status, po.id AS po, po.status AS etape_po,
       peers.commandes_du_po,
       (market.code, o.reference) IN (
         ('KM','KG6BRN8'), ('KM','KEUV1BR'), ('KM','KFV1J2A'), ('KM','KG2R3C4'),
         ('CM','KHE0W13'), ('CM','KNCGJ00'), ('CM','KU61CW8'), ('CM','K3IZCBU'),
         ('CM','KCWKF7Q'), ('CM','KH2OIGF'), ('CG','KLG239M'), ('CG','KCP76WT')
       ) AS campagne_18_11
FROM orders o
LEFT JOIN markets market ON market.id = o.market_id
LEFT JOIN membership m ON m.order_id = o.id
LEFT JOIN purchase_orders po ON po.id = m.po_id
LEFT JOIN peers ON peers.po_id = po.id
WHERE o.simulation_scope = 'G6-BUYER'
  AND o.status NOT IN ('collected','cancelled')
ORDER BY market.code, o.reference, po.id;
COMMIT;
~~~

## Gestes du propriétaire

1. Avant tout geste, obtenir le GO et vérifier pour chaque référence la commande, le marché, le paiement et toutes les commandes du PO. Laisser en attente un PO partagé avec une commande hors sélection, un dossier remboursé ou un dossier qui impliquerait un PSP ou fournisseur externe.
2. Pour un PO exclusivement composé des cibles approuvées et toujours en brouillon, ouvrir **Opérations → Achats fournisseurs** (`/admin/workspaces/purchasing`), sélectionner **À préparer**, retrouver le PO et contrôler ses lignes. Choisir **Écarter le brouillon** et confirmer. Le service marque le PO annulé et détache ses lignes. Contrôler le PO dans l’historique des achats.
3. Dans les lignes ouvertes, identifier uniquement celles des commandes approuvées, y compris la ligne hors PO. Choisir **Annuler** pour la ligne concernée et renseigner le motif « Recette G6 interrompue le 18/11 — référence de commande ». Contrôler le retour à l’écran après chaque geste.
4. En admin, ouvrir **Commandes**, puis la fiche **Order 360** de la référence G6. Vérifier le marché et le paiement cash relais. Choisir **Annuler la commande de recette** et vérifier la référence dans la confirmation. La règle de coupure du serveur reste applicable. Attendre **Commande de recette … annulée** sur la fiche rechargée. En cas de refus ou de réponse incertaine, relever le message et rafraîchir la fiche avant toute reprise.
5. Rejouer l’inventaire en lecture seule. Reporter par référence l’étape encore visible et le résultat des gestes. Une commande absente de cet inventaire peut être retirée ou annulée : vérifier son état final dans sa fiche avant de la compter comme annulée.

## Nettoyage automatisé par les écrans (workflow propriétaire)

Workflow `staging-g6-cleanup-recette.yml`, déclenché par un titre d’issue du propriétaire, avec la même garde propriétaire et la même garde SHA que le rejeu dynamique G6. Staging uniquement, aucune écriture SQL, aucun PSP ni fournisseur réel, cadence G0c (une 429 met le run en `NOT_PROVEN_429`).

- `[staging-op] g6-cleanup-recette` : mode **plan**. Inventaire PG en lecture seule. Le rapport donne, par commande, la classe, les gestes écran prévus, le PO et les commandes qui partagent ce PO.
- `[staging-op] g6-cleanup-recette-apply` : mode **apply**. Rejoue les gestes dans Chromium avec le rôle admin (`E2E_ADMIN_*`, qui franchit aussi la garde Hub des achats groupés) et les helpers `humanClick`, `humanFill`, `humanGoto`. Un geste par objet, preuve de la réponse HTTP et relecture PG, jamais de second clic après une mutation. Il se termine par l’inventaire final : N commandes restantes, avec la raison.

### Classes et geste écran

| Classe | Définition | Geste écran |
|---|---|---|
| A | PO brouillon | Achats fournisseurs : **Écarter le brouillon**, puis **Annuler** les lignes devenues ouvertes, puis Order 360 **Annuler la commande de recette** |
| B | sans PO | **Annuler** la ligne (si elle existe), puis Order 360 **Annuler la commande de recette** |
| C | PO `notified` ou `confirmed` | Achats fournisseurs **Annuler le PO de recette** (100 % G6, cash, sans débit réel ni réception), puis Order 360 **Annuler la commande de recette** |
| D | marchandise reçue (PO `hub_received`/`received`/`partially_received`, ou commande `preparation`, `shipped`, `in_transit`, `available`) | Order 360 **Clôturer la recette (marchandise au Hub)**. Refus explicite si un colis est sorti, une unité est partagée, un sac est lié immuablement à une KOM-BOX ou une expédition existe |

Règles : seul `simulation_scope='G6-BUYER'` est touché ; un PO qui contient une commande non G6 (ou dont les commandes ne sont pas lisibles) est refusé (`MIXED_PO`) ; le paiement doit être `cash_relais` ; la règle de coupure serveur `CANCEL_CUTOFF_STATUS` (défaut `shipped`, exclu) est lue et appliquée avant tout geste. Ordre d’exécution : PO brouillons, lignes, commandes A et B, puis C.

### Deux écrans G6-CLEANUP (PRs de clôture, validation CI requise)

1. **D, marchandise reçue** : Order 360 admin « Clôturer la recette (marchandise au Hub) », uniquement G6 cash et avec motif. La marchandise reste traçable en **quarantaine Hub** ; aucun retour fictif en stock vendable. Refus si sac–KOM-BOX scellé/immuable, colis hors Hub, unité partagée ou expédition liée.
2. **C, PO engagé** : Achats fournisseurs « Annuler le PO de recette », PO `notified`/`confirmed` entièrement G6 cash sans réception ni débit fournisseur vérifié. Annule/détache les lignes, résout ses alertes ciblées, aucun appel fournisseur.

### Usage et enchaînement

Lancer `plan`, relire le rapport, puis `apply` sur GO du propriétaire. **Recommandation : l’enchaîner en fin de campagne Golden** pour laisser le staging propre.

**Attention :** les clôtures physiques hors Hub ne sont jamais forcées. Elles restent en `REFUSED` avec preuve et motif pour revue humaine. Aucun SQL d’effacement de lien `hub_box_bags` n’est permis.

## Classe D, sous-classes et gestes (G6-CLEANUP-D)

Le nettoyage du 21/11 laisse 22 commandes D `ENCORE_OUVERTE_APRES_GESTES` : la clôture Hub refuse les commandes déjà au relais (colis sorti du Hub, aucune unité Hub) ou liées à une KOM-BOX. Le plan classe donc chaque D par état réel (PG, lecture seule) :

| Sous-classe | Critère | Geste écran |
|---|---|---|
| `D_PAID_AVAILABLE` | `available`, payée, relais et code présents, aucune unité Hub | **Remise comptoir** (`handover_relay`) : l’agent dédié est rattaché au relais de la commande par l’écran Réseau, on attend la fin du verrou N23 (jamais de contournement), le code est lu sur l’écran client (régénération client, comme M02), saisi au comptoir **Remises**. Relecture PG : `collected`. |
| `D_DISCREPANCY` | idem avec écart de réception N20 (incident, quantité reçue < attendue) | Même remise (quantité constatée). L’incident reste ouvert : `SCREEN_MISSING_INCIDENT_RESOLUTION` (aucun écran de résolution d’incident ; plus petit écran : bouton « Résoudre » sur l’incident ouvert du marché, avec motif). |
| `D_BOX_FROZEN` | un sac ou une KOM-BOX lié(e) dans `hub_box_bags` | `SCREEN_MISSING_KOM_BOX_FROZEN`. Plus petit écran : Order 360 admin « Solder la recette (KOM-BOX figée) », G6-BUYER cash, motif obligatoire, événement de clôture audité, sans jamais effacer `hub_box_bags`. |
| `D_OTHER` | disponible mais impayée, sans relais ou sans code | `SCREEN_MISSING_D_AVAILABLE_NOT_HANDOVERABLE`. |
| `D_HUB_GOODS` | marchandise encore au Hub | Clôture Hub existante. |

Aucun geste « retour » ni « annulation avec remboursement cash » n’existe pour une commande `available` : l’annulation Order 360 est bloquée par la coupure serveur. La remise est donc le seul geste légitime.

Garde-fous : `G6-BUYER` seulement, PO mixte refusé avant toute classification D, une mutation par commande (un processus enfant, aucune seconde tentative), relecture PG `collected`, code de retrait jamais affiché ni écrit. Les remises s’exécutent en mode `apply` ; `plan` expose `d_class`, `proposal` et `missing`.

## Recommandation : chaque scénario négatif se clôt lui-même

Les 22 orphelines viennent de N20, N21, N22, N23 et N29, qui s’arrêtent sur une commande payée « disponible ». Proposition : ajouter à la fin de chaque scénario négatif une étape de clôture (remise au comptoir par le code client, ou annulation par un écran quand il existe), exécutée même en cas d’échec de l’oracle, une fois le verrou N23 levé. À défaut, le scénario laisse sa commande dans une classe que le nettoyage sait clore (A, B, C, ou D payée disponible). Éviter de produire des liens KOM-BOX sur des commandes de scénario négatif : ils sont immuables et non clôturables par écran.
