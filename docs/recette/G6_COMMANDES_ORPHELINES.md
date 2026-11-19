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
| C | PO `notified` ou `confirmed` | Order 360 **Annuler la commande de recette** (si le statut est avant la coupure). Le PO groupé reste engagé avec une alerte : `SCREEN_MISSING` pour l’annulation du PO |
| D | marchandise reçue (PO `hub_received`/`received`/`partially_received`, ou commande `preparation`, `shipped`, `in_transit`, `available`) | `SCREEN_MISSING`, aucun geste |

Règles : seul `simulation_scope='G6-BUYER'` est touché ; un PO qui contient une commande non G6 (ou dont les commandes ne sont pas lisibles) est refusé (`MIXED_PO`) ; le paiement doit être `cash_relais` ; la règle de coupure serveur `CANCEL_CUTOFF_STATUS` (défaut `shipped`, exclu) est lue et appliquée avant tout geste. Ordre d’exécution : PO brouillons, lignes, commandes A et B, puis C.

### Écrans manquants (non codés, plus petit écran proposé)

1. **D, marchandise reçue** : sur Order 360 admin, une action « Clôturer la recette (marchandise au Hub) » réservée aux commandes `G6-BUYER`, qui passe outre la coupure, restitue la marchandise en stock Hub (ou la déclare invendue) et clôt la commande, avec motif obligatoire.
2. **C, PO engagé** : sur le détail d’un PO groupé `notified`/`confirmed` entièrement G6, une action « Annuler le PO de recette » qui annule le PO et ses lignes, sans appel fournisseur.

### Usage et enchaînement

Lancer `plan`, relire le rapport, puis `apply` sur GO du propriétaire. **Recommandation : l’enchaîner en fin de campagne Golden** pour laisser le staging propre.
