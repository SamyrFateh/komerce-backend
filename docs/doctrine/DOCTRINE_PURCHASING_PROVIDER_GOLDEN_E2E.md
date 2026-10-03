# Doctrine — Purchasing Provider Contract & Full-Chain Golden E2E

## Objet

Formaliser la prochaine étape de Komerce : qualifier chaque adapter achat fournisseur avec la même discipline que le sourcing/catalogue, puis prouver la continuité réelle de toute la chaîne :

    Catalogue publiable
    → achat B2C payé
    → besoin d'approvisionnement
    → purchase_line exacte
    → Purchase Order
    → dialogue API achat fournisseur
    → preuve fournisseur
    → coût B2B confirmé
    → comptabilité B2B scopée
    → comptabilité B2C scopée
    → rapprochement économique

Cette doctrine complète les doctrines External Provider Contract Proofs, Procurement Fulfillment, Canonical Unit Purchasing et Supplier Order Identity. Elle ne remplace aucune autorité existante.

## 1. Principe directeur

Le sourcing répond : « Qu'est-ce que le fournisseur propose et quelle unité exacte Komerce peut-il commercialiser ? »

Purchasing répond : « Puis-je acheter maintenant exactement l'unité vendue, dans cette quantité, selon les capacités réelles de ce fournisseur, puis prouver l'engagement obtenu ? »

La comptabilité répond : « Quels faits économiques réels ont été constatés, dans quel scope, et sont-ils rapprochés avec la vente client correspondante ? »

Ces trois domaines sont synchronisés mais restent propriétaires de leurs faits.

## 2. Aucun gate de confirmation humaine Komerce

Le nominal ne comporte aucune confirmation humaine Komerce entre les étapes.

Une transition avance automatiquement lorsque son contrat est prouvé :

    fact emitted
    → invariant verified
    → acknowledgement/evidence obtained
    → next fact emitted

L'humain n'est jamais un mécanisme de synchronisation.

Si un provider ne possède pas d'API buyer-side pour une opération, cela constitue une capability fournisseur fermée, pas une demande de confirmation Komerce.

Exemple Allegro Sandbox : l'achat manuel externe peut servir de preuve provider et de test de réconciliation, mais il ne doit jamais être présenté comme un Golden d'auto-order.

## 3. Contrat canonique d'un adapter achat

Un provider Purchasing peut exposer tout ou partie de :

    evaluate()
    buildOrderPayload()
    placeOrder()
    reconcile()

Capacités complémentaires possibles :

    remote_preflight
    auto_order
    manual_procurement
    multi_item
    shipping_quote
    tracking
    cancellation
    refund
    invoice
    provider_payment

Règle : capability absente ou non prouvée = CLOSED, jamais PASS implicite.

Le core Purchasing ne doit jamais contenir une branche provider-spécifique pour interpréter une sémantique ordinaire d'achat.

## 4. Conversation achat obligatoire

Avant P0..P4, chaque provider doit documenter les six phases de conversation.

### EXPECTS

Ce dont Komerce a besoin pour acheter :
- Supplier Order Identity exacte ;
- supplier_unit_ref ;
- quantité ;
- prix/devise attendus ;
- route d'approvisionnement / Procurement Hub ;
- éventuelles contraintes de fret.

### REQUIRES

Ce que le provider exige :
- credentials / rôle de compte ;
- paramètres obligatoires ;
- pays ou destination ;
- minimum de commande ;
- politiques / méthodes de livraison ;
- capacité buyer-side si nécessaire.

### SENDS

Ce que Komerce envoie :
- unité native exacte ;
- quantité ;
- destination fournisseur canonique ;
- paramètres de livraison ;
- clé d'idempotence si le provider la supporte.

### RECEIVES

Ce que le provider retourne :
- statut d'acceptation ;
- référence de commande ;
- prix/devise ;
- quantités acceptées ;
- livraison / tracking si disponible.

### CONFIRMS

Ce que Komerce peut relire ou vérifier :
- commande réellement créée ;
- unité exacte ;
- quantité ;
- montant natif ;
- statut d'engagement ;
- éventuel tracking.

### EXPOSES

Ce que Purchasing expose aux couches suivantes :
- Purchase Order Komerce ;
- purchase_line exacte ;
- supplier_order_id vérifié ;
- coût fournisseur confirmé ;
- devise native ;
- statut d'engagement canonique ;
- scope économique d'origine.

## 5. Échelle de preuve P0 → P4 — Achat

La doctrine transversale External Provider Contract Proofs reste l'autorité.

### P0 — BUSINESS_READINESS

Prouver que le compte et le contrat fournisseur permettent l'opération ciblée : buyer-side autorisé, sandbox utilisable, livraison vers Procurement Hub permise, moyen de paiement compatible, minimum de commande satisfait.

### P1 — RAW_API

Prouver directement l'opération native minimale, hors orchestration Komerce.

Pour un provider auto-order :

    read exact unit
    → live stock / price
    → shipping/preflight
    → create order
    → receive external order id
    → read-back exact order

Toute mutation doit être explicitement autorisée, bornée et testée dans l'environnement approprié.

### P2 — ADAPTER

Prouver la traduction canonique :

    canonical purchase input
    → provider request

    provider response/read-back
    → canonical purchasing result

Les statuts natifs ne franchissent pas la frontière.

### P3 — PIPELINE

Prouver la composition Komerce :

    order_item
    → exact product_sku_id
    → exact Supplier Order Identity
    → canonical procurement readiness
    → purchase_line
    → PO
    → execution boundary
    → provider evidence
    → confirmation

Doit inclure fail-closed, idempotence, aucune substitution d'unité, aucune double commande fournisseur et préservation prix/devise natifs.

### P4 — GOLDEN_E2E PROVIDER

Prouver le flux provider réel complet pour la capability considérée.

Un P4 manual_procurement et un P4 auto_order sont deux preuves différentes. L'un ne promeut jamais implicitement l'autre.

## 6. Golden E2E Full Chain Komerce

Le Golden de référence dépasse le seul provider et prouve la synchronisation B2C / Purchasing / Finance.

Cas V1 :

    1 marché
    1 client
    1 order
    1 order_item
    1 SKU
    1 Supplier Order Identity
    1 provider
    quantité = 1
    aucun coupon
    aucun split
    aucun remboursement
    aucun multi-provider

Séquence de test attendue :

    CATALOGUE_PUBLIC
    → PAYMENT_CAPTURED
    → ORDER_PAID
    → PURCHASING_TRIGGERED
    → PURCHASE_LINE_CREATED
    → PROCUREMENT_READY
    → PO_CREATED / PREPARED
    → PROVIDER_ORDER_SUBMITTED
    → PROVIDER_COMMITMENT_CONFIRMED
    → B2B_COST_CONFIRMED
    → B2B_ACCOUNTING_PROJECTED
    → B2C_ACCOUNTING_PROJECTED
    → FINANCIAL_RECONCILED
    → ECONOMICALLY_CLOSED

Ces noms décrivent le contrat de test. Ils ne créent pas automatiquement de nouveaux statuts DB : réutiliser les autorités existantes avant toute migration.

## 7. Corrélation obligatoire

Le test ne doit jamais seulement comparer des montants ou des statuts indépendants.

Il doit reconstruire :

    market_id
    → order_id
    → order_item_id
    → purchase_line_id
    → purchase_order_id
    → product_sku_id
    → supplier_order_identity
    → supplier_order_id / external_ref
    → accounting references

Invariant : la même histoire économique doit être reconstructible dans les deux sens.

## 8. Comptabilité scopée

Le marché est porté par la ligne d'achat via :

    purchase_line
    → order_item
    → order
    → market_id

Une PO regroupée peut contenir plusieurs marchés ; la PO n'est donc jamais le scope comptable unique.

Le rapprochement B2B doit être ventilé par ligne/scopes avant rapprochement avec B2C.

Minimum du scope économique V1 :

    legal_entity
    market_id
    order_id
    order_item_id
    purchase_line_id
    purchase_order_id
    supplier_id
    product_sku_id
    currency

Principe : on ne rapproche jamais seulement des montants ; on rapproche des montants appartenant au même scope économique.

Le coût fournisseur réel doit venir des faits confirmés de Purchasing, jamais d'un coût catalogue historique présenté comme réel.

La comptabilité market-scoped existante reste l'autorité de projection Finance. La construction explicite de la ventilation B2B par v_purchase_line_market est un chantier de cette campagne, pas un fait déjà supposé terminé.

## 9. Synchronisation et acknowledgements

Chaque frontière définit :

    fact produced
    → expected acknowledgement
    → timeout / retry policy
    → failure fact
    → downstream consequence

Exemple auto-order :

    PROCUREMENT_READY
    → placeOrder()
    → provider external order id
    → reconcile()
    → commitment confirmed

Un HTTP 200/201 ne suffit pas si le provider peut être relu : la confirmation vient du read-back/reconcile lorsque la capability existe.

## 10. Idempotence — test obligatoire de sûreté

Cas critique pour chaque provider auto-order :

    Komerce appelle placeOrder()
    → provider crée la commande
    → réponse réseau perdue
    → Komerce rejoue

Résultat attendu :

    1 order B2C
    → 1 obligation fournisseur
    → 1 engagement fournisseur réel

Jamais deux commandes provider.

Si le provider expose une clé d'idempotence, l'adapter doit l'utiliser. Sinon le contrat doit documenter la stratégie de recherche/read-back avant retry. Une stratégie inconnue bloque l'auto-order.

## 11. Matrice provider de départ

État constaté au moment de cette doctrine :

| Provider | Sourcing | Purchase readiness | build payload | placeOrder | reconcile | Golden achat actuel |
|---|---|---:|---:|---:|---:|---|
| Allegro Sandbox | prouvé sur chemin contrôlé | oui | oui | non | oui | P4 manual procurement, auto-order CLOSED |
| AliExpress | catalogue/connectivité existants | oui, live stock/prix/fret | non prouvé comme execution adapter complet | non | non prouvé | à construire |
| CJ | catalogue + stock autoritaire prouvés | pas d'adapter fulfillment enregistré à ce jour | non | non | non | à construire |

Cette matrice décrit l'état du code et des preuves, pas les capacités théoriques des APIs externes.

Chaque évolution modifie la fiche provider et les preuves P0..P4 avant d'ouvrir une capability.

## 12. Ordre des E2E

### E2E-A0 — Golden interne simple sans side-effect provider

Prouver :
- order payé ;
- exact order_item ;
- exact SKU/SOI ;
- purchase_line ;
- PO ;
- scope marché conservé ;
- aucun double achat.

### E2E-A1 — Allegro manual-procurement evidence

Réutiliser le P4 existant pour prouver :
- exact PO ;
- achat externe observé ;
- reconcile ;
- PO confirmée ;
- coût natif ;
- scope préservé.

Ne doit pas revendiquer auto-order.

### E2E-A2 — AliExpress readiness

Prouver :
- exact unit ;
- stock live ;
- prix live ;
- fret Procurement Hub ;
- fail-closed ;
- aucune mutation fournisseur.

### E2E-A3 — Premier provider auto-order

Seulement après P0/P1/P2 :
- buildOrderPayload ;
- placeOrder ;
- retry/idempotence ;
- read-back/reconcile ;
- PO confirmée.

AliExpress ou CJ ne devient ce provider pilote que lorsque son vrai contrat buyer-side est prouvé.

### E2E-B1 — Couture B2B accounting

À partir d'une purchase_line confirmée :
- coût réel ;
- devise ;
- quantité ;
- market_id via v_purchase_line_market ;
- projection comptable B2B scoped.

### E2E-C1 — Couture B2C ↔ B2B

Même order/order_item :
- paiement B2C constaté ;
- coût B2B constaté ;
- aucun mouvement orphelin ;
- scope identique ;
- rapprochement.

### E2E-G1 — Full-chain Golden

Assembler :
- Boutique ;
- checkout/paiement ;
- order ;
- Purchasing provider réel ;
- PO ;
- preuve fournisseur ;
- compta B2B ;
- compta B2C ;
- rapprochement.

Le Golden final ne doit découvrir aucune capacité élémentaire du provider.

## 13. Scénarios d'exception à ajouter ensuite

Après le nominal V1 :
1. stock disparu après paiement ;
2. prix fournisseur changé ;
3. SOI divergente ;
4. provider timeout avant création ;
5. provider crée l'ordre mais la réponse est perdue ;
6. retry après ordre déjà créé ;
7. quantité fournisseur partiellement acceptée ;
8. freight devenu indisponible ;
9. confirmation provider ambiguë ;
10. remboursement B2C après engagement fournisseur ;
11. deux produits même fournisseur ;
12. split multi-provider ;
13. PO regroupée multi-marché ;
14. coût final différent du coût preflight ;
15. annulation/refund provider si capability prouvée.

Chaque découverte devient un contrat de régression.

## 14. Alertes

Les alertes existent pour une exception machine, jamais comme étape normale de confirmation.

Une alerte expose :
- order / order_item ;
- purchase_line / PO ;
- provider ;
- étape attendue ;
- dernier fait confirmé ;
- fait manquant ;
- nombre de tentatives ;
- impact économique ;
- scope marché.

Exemples :
- order payé mais aucune ligne d'achat ;
- PO soumise sans preuve provider ;
- provider engagement confirmé mais coût B2B non projeté ;
- mouvement B2B sans order_item source ;
- B2C settled mais B2B non rapproché.

## 15. Definition of Done

Un provider peut être déclaré PURCHASABLE_AUTO uniquement si :

    Conversation PASS
    P0 PASS
    P1 create/read-back PASS
    P2 adapter execution PASS
    P3 pipeline PASS
    idempotence PASS
    P4 auto-order Golden PASS

Un provider peut être PURCHASABLE_MANUAL avec une preuve distincte, sans ouvrir auto_order.

Le Full-chain Komerce est vert uniquement si :

    B2C commercial fact
    + Purchasing supplier fact
    + B2B scoped accounting fact
    + B2C scoped accounting fact
    + reconciliation

sont tous corrélés, sans fait financier orphelin et sans perte de scope.

## 16. Règle de campagne

Pour AliExpress, Allegro, CJ puis tout futur provider :

> on ne teste pas le provider en bloc ; on qualifie capability par capability, P0 → P4, puis on compose seulement les capabilities vertes dans le Golden full-chain.
