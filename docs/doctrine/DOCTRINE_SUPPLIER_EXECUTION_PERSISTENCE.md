# Doctrine — Supplier Execution Persistence

## But

Une Purchase Order Komerce décrit l'engagement métier d'approvisionnement.
Le dialogue natif avec un fournisseur externe possède ses propres identifiants,
parents, références de paiement et étapes de reprise.

Ces deux modèles ne doivent pas être confondus.

## Contrat canonique

Komerce persiste quatre concepts indépendants du fournisseur :

1. `supplier_execution_orders`
   - sous-ordre natif provider ;
   - identifiant canonique : `supplier_order_id` ;
   - identifiant lisible/secondaire éventuel : `supplier_order_code`.

2. `supplier_execution_order_lines`
   - rattachement d'un sous-ordre provider aux besoins `purchase_lines` ;
   - permet 1→N et N→1 sans réécrire le modèle métier de la PO.

3. `supplier_execution_groups`
   - parent/groupe provider ;
   - identifiant canonique : `supplier_parent_order_id` ;
   - référence de paiement éventuelle : `payment_ref`.

4. `supplier_execution_events`
   - journal append-only du dialogue externe ;
   - opérations, verdicts, request ids et faits bornés nécessaires au diagnostic/replay.

## Mapping provider

Un adapter traduit le vocabulaire natif vers le contrat canonique.

Exemple CJ prouvé en sandbox :

    orderId / cjOrderCode
      → supplier_order_id / supplier_order_code

    shipmentOrderId
      → supplier_parent_order_id

    payId
      → payment_ref

Les noms CJ ne deviennent jamais des colonnes du coeur Purchasing.

## Invariants

- Les credentials, tokens, secrets et payloads provider bruts ne sont jamais persistés dans ce modèle.
- Un `supplier_order_id` est unique dans le namespace d'un provider.
- Un `supplier_parent_order_id` est unique dans le namespace d'un provider.
- Un parent ne peut regrouper que des sous-ordres de la même Purchase Order Komerce et du même provider.
- Le journal n'invente pas d'état provider : il enregistre uniquement un outcome canonique et des faits observés/sanitisés.
- La persistance précède toute ouverture d'auto-purchase production nécessitant une reprise crash-safe.

## Reprise

Après interruption du process, l'orchestrateur doit pouvoir relire la DB et reprendre
au prochain acte non confirmé, sans recréer silencieusement un sous-ordre ni repayer un parent.

Exemple :

    PO persisted
    → provider sub-orders persisted
    → parent persisted
    → crash
    → restart
    → load supplier_execution_*
    → resume from last proven event

La migration 279 pose uniquement le modèle et ses gardes. Le wiring runtime est un lot séparé.
