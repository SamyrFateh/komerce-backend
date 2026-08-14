# Doctrine des documents transactionnels Komerce

> **Version** : 2026-08 — accès client authentifié, aucun transport documentaire WhatsApp.

## Statut du document

Ce document est un pilier d'architecture.

Il définit la couche documentaire officielle de Komerce : les documents qui prouvent qu'un événement métier a réellement eu lieu.

Il complète la doctrine facture :

```text
DOCTRINE_FACTURE_KOMERCE.md
```

La facture est le premier cas. Mais Komerce a besoin d'une famille complète de documents transactionnels.

## Principe central

Un document transactionnel Komerce ne prouve jamais une intention.

Il prouve un événement confirmé.

Donc :

```text
commande créée        -> notification, pas facture
paiement confirmé     -> facture
remboursement confirmé -> avoir / reçu de remboursement
commande issue d'une liste partagée payée -> facture de cette commande
wallet crédité/débité -> reçu wallet / relevé wallet
retrait confirmé      -> preuve de retrait
sourcing déclenché    -> bon de commande fournisseur interne
```

La règle commune :

```text
pas d'événement confirmé = pas de document officiel
```

## Pourquoi cette couche est importante

Komerce mélange plusieurs réalités métier :

- commande individuelle ;
- paiement cash relais ;
- paiement Stripe / PayPal ;
- wallet ;
- panier partagé ;
- liste partagée avec commandes indépendantes ;
- annulation ;
- remboursement ;
- retrait relais ;
- sourcing fournisseur.

Sans doctrine documentaire, chaque flux risque de produire son propre PDF, son propre message, son propre vocabulaire et ses propres incohérences.

La couche documentaire sert à :

- protéger la confiance client ;
- éviter les preuves émises trop tôt ;
- garder une cohérence comptable ;
- rendre les documents directement disponibles dans le compte client ;
- donner aux admins une trace stable ;
- éviter les doublons causés par les webhooks rejoués ;
- séparer document client, document interne et document fournisseur.

## Règle absolue

Chaque document transactionnel doit être :

- postérieur à l'événement qu'il prouve ;
- idempotent ;
- lié à une référence métier stable ;
- généré depuis des données figées ;
- accessible uniquement dans un espace authentifié, avec contrôle du propriétaire ;
- matérialisé en PDF privé avec empreinte d'intégrité ;
- traçable dans l'historique de la commande, du panier, du wallet ou du remboursement.

Un document ne doit jamais être généré :

- à la simple création d'une commande ;
- à l'ouverture d'une session Stripe ;
- à l'affichage d'un code cash ;
- à une promesse de paiement ;
- à une estimation de panier partagé ;
- à un remboursement demandé mais non confirmé ;
- à un événement webhook non vérifié.

## Famille documentaire cible

### 1. Facture de commande

Document client officiel.

Déclencheur :

```text
payment_confirmed
```

Point d'ancrage :

```text
confirmPaymentCycle(...)
```

ou hook strictement postérieur.

Ne jamais générer dans :

```text
POST /api/orders
```

Document détaillé :

```text
DOCTRINE_FACTURE_KOMERCE.md
```

### 2. Avoir / reçu de remboursement

Document client officiel.

Déclencheur :

```text
refund_confirmed
```

Il prouve qu'un remboursement a été effectué ou qu'un avoir a été crédité.

Nom recommandé selon le cas :

- `Avoir` si on corrige une facture déjà émise ;
- `Reçu de remboursement` pour un langage client simple ;
- `Note de crédit wallet` si le remboursement devient un crédit Komerce.

Ne pas générer à la demande de remboursement.

Générer seulement après succès réel :

- refund Stripe accepté ;
- refund PayPal accepté ;
- crédit wallet confirmé ;
- remboursement cash marqué comme exécuté par un admin ;
- commande issue d'une liste partagée remboursée.

### 3. Liste partagée

La liste partagée actuelle n'est pas un système de contributions financières.
Chaque acheteur paie sa propre commande et reçoit la facture de cette commande.

Aucun « reçu de contribution » ne doit être réintroduit sans un nouveau domaine
métier de contribution payé et confirmé.

### 4. Reçu wallet / relevé wallet

Document client ou admin.

Déclencheur :

```text
wallet_credit_confirmed
wallet_debit_confirmed
wallet_reversal_confirmed
```

Usage :

- remboursement transformé en avoir ;
- crédit fidélité ;
- utilisation wallet sur commande ;
- reverse wallet lors d'annulation.

Le wallet ne doit pas être un trou noir comptable.

Chaque mouvement important doit pouvoir être expliqué par une référence :

- commande ;
- remboursement ;
- geste commercial ;
- annulation ;
- commande issue d'une liste partagée.

### 5. Preuve de retrait relais

Document client / relais.

Déclencheur :

```text
pickup_collected
```

Il prouve que la commande a été retirée.

Ce n'est pas une facture.

Il peut contenir :

- référence commande ;
- point relais ;
- agent ;
- date de retrait ;
- identité ou téléphone du bénéficiaire ;
- code de retrait si pertinent ;
- signature ou trace de scan plus tard.

### 6. Bon de commande fournisseur / sourcing

Document interne ou fournisseur.

Déclencheur :

```text
sourcing_triggered
purchase_order_created
```

Il sert à l'agent ou au fournisseur.

Ce n'est pas un document client.

Il peut contenir :

- références produits ;
- quantités ;
- variantes ;
- fournisseur ;
- coût estimé ;
- destination ;
- consignes de sourcing ;
- lien avec commande client.

Il ne doit pas exposer au fournisseur les données client inutiles.

## Architecture recommandée

Créer une couche documentaire centralisée :

```text
services/document-service.js
services/invoice-service.js
services/refund-document-service.js
services/contribution-receipt-service.js
services/wallet-document-service.js
services/pickup-receipt-service.js
services/purchase-order-document-service.js
```

Ou une structure équivalente :

```text
services/documents/
  invoice.js
  refund-receipt.js
  wallet-receipt.js
  pickup-receipt.js
  purchase-order.js
```

Le principe doit rester :

```text
service métier confirme l'événement
-> service documentaire génère ou retourne le document existant
-> compte authentifié liste et télécharge le document
```

## Table ou stockage recommandé

Prévoir une table documentaire générique ou des tables spécialisées.

Option générique :

```text
transaction_documents
```

Champs recommandés :

```text
id
document_type
subject_type
subject_id
order_id
shared_cart_id
wallet_transaction_id
refund_id
reference
status
file_url
file_storage_key
owner_user_id
pdf_content
pdf_sha256
pdf_filename
pdf_generated_at
template_version
issued_at
issued_by
metadata
created_at
updated_at
```

Contrainte d'idempotence :

```text
UNIQUE(document_type, subject_type, subject_id)
```

ou une contrainte plus spécifique selon le type :

```text
UNIQUE(document_type, order_id)
UNIQUE(document_type, refund_id)
UNIQUE(document_type, wallet_transaction_id)
```

## Idempotence obligatoire

Chaque service documentaire doit suivre ce modèle :

```js
async function issueDocument(subjectId) {
  const subject = await loadSubject(subjectId);

  assertEventConfirmed(subject);

  const existing = await findExistingDocument(subject);
  if (existing) return existing;

  const data = normalizeDocumentData(subject);
  const pdf = await generatePdf(data);
  const document = await persistDocument(subject, pdf);

  return document;
}
```

Cette règle est obligatoire pour :

- webhook Stripe rejoué ;
- webhook PayPal rejoué ;
- double clic admin ;
- retry réseau ;
- tâche cron relancée ;
- consultation client répétée.

## Séparation des responsabilités

Le service métier décide si l'événement est confirmé.

Le service documentaire génère la preuve.

La route authentifiée vérifie le propriétaire puis transmet le PDF.

Donc :

```text
payment-service       -> confirme paiement
invoice-service       -> émet facture
documents route       -> contrôle propriétaire et télécharge
```

```text
refund-service          -> confirme remboursement
refund-document-service -> émet avoir / reçu
documents route         -> contrôle propriétaire et télécharge
```

La notification ne doit ni générer, ni joindre, ni lier le document.

Le générateur PDF ne doit pas décider si un événement est valide.

## Lecture du code actuel

### Paiement confirmé

Points propres déjà visibles :

- Stripe passe par `confirmPaymentCycle(...)` ;
- cash relais passe par `confirmPaymentCycle(...)` ;
- PayPal passe aussi par `confirmPaymentCycle(...)` dans les flux de capture ;
- le wallet full payment utilise également ce cycle.

Conclusion :

```text
confirmPaymentCycle(...) est le point naturel pour déclencher l'émission facture après paiement.
```

### Remboursement / annulation

Points visibles :

- l'annulation de commande appelle `processRefund(...)` avant changement de statut ;
- le remboursement peut être Stripe ou wallet ;
- PayPal contient une logique de refund dédiée ;
- le panier partagé possède une file `refund-queue`.

Conclusion :

```text
processRefund(...) ou un hook postérieur est le point naturel pour émettre un avoir / reçu de remboursement.
```

Il faut toutefois aligner les flux PayPal et panier partagé pour qu'ils exposent un événement `refund_confirmed` stable.

## Doctrine remboursement

Un remboursement doit produire un document seulement si le remboursement est confirmé.

Cas :

```text
refund_requested  -> pas de document officiel
refund_processing -> pas de document officiel
refund_confirmed  -> avoir / reçu de remboursement
refund_failed     -> notification d'échec, pas de document officiel
```

Le document doit contenir :

- référence commande ;
- référence facture d'origine si disponible ;
- référence remboursement ;
- montant remboursé ;
- devise ;
- méthode : Stripe, PayPal, cash, wallet ;
- date de remboursement confirmé ;
- raison ;
- remboursement total ou partiel ;
- solde restant payé si remboursement partiel ;
- référence du panier partagé ou contribution si applicable.

## Doctrine liste partagée

La liste partagée introduit plusieurs commandes indépendantes :

```text
acheteur réserve des articles -> pas de document
acheteur paie sa commande -> facture de sa commande
commande remboursée -> reçu de remboursement de son payeur
```

Ne pas confondre :

- réservation d'article ;
- commande créée ;
- paiement confirmé ;
- remboursement confirmé.

Seul le paiement réel produit un document.

## Doctrine wallet

Le wallet peut porter :

- un remboursement ;
- un geste commercial ;
- une fidélité ;
- une utilisation partielle sur commande ;
- un reverse lors d'annulation.

Chaque mouvement wallet doit avoir une cause lisible.

Un reçu wallet doit être générable pour les mouvements significatifs.

Mais une facture ne doit pas être générée pour un simple mouvement wallet sauf si ce mouvement confirme le paiement total d'une commande.

## Doctrine WhatsApp

WhatsApp ne transporte aucun document et aucun lien documentaire.

WhatsApp ne crée pas les preuves.

Avant événement confirmé :

- message informatif ;
- demande de paiement ;
- code relais ;
- lien de suivi.

Après événement confirmé, un message peut uniquement indiquer que le document
est disponible dans « Mon Komerce », sans URL de téléchargement ni pièce jointe.

```text
Paiement confirmé pour la commande {reference}.
Votre facture est disponible dans Mon Komerce.
```

## Ordre de mise en oeuvre recommandé

### Phase 1 — Socle

- créer table ou modèle `transaction_documents` ;
- créer un service documentaire générique ;
- brancher la facture après paiement confirmé ;
- corriger `facture_komerce.js`.

### Phase 2 — Remboursement

- formaliser `refund_confirmed` ;
- aligner Stripe, PayPal, wallet et cash ;
- émettre avoir / reçu de remboursement ;
- rendre le flux idempotent.

### Phase 3 — Panier partagé

- rattacher chaque facture à la commande réellement payée par son acheteur ;
- ne créer aucun reçu de contribution dans le modèle de liste partagée actuel.

### Phase 4 — Wallet et relais

- reçus wallet ;
- preuve de retrait ;
- accès client dans Mon Komerce, sous le wallet.

### Phase 5 — Sourcing

- bon de commande fournisseur interne ;
- document agent ;
- séparation stricte client/fournisseur.

## Interdits définitifs

Ne jamais :

- émettre une facture pour une commande non payée ;
- émettre un avoir pour un remboursement non confirmé ;
- utiliser une facture comme code relais ;
- utiliser un reçu de contribution comme facture finale ;
- générer deux documents pour le même événement ;
- envoyer un document, une pièce jointe ou un lien documentaire par WhatsApp ;
- exposer une route documentaire publique ou un jeton de téléchargement partageable ;
- recalculer des montants au moment du PDF si des montants figés existent ;
- exposer des données client dans un document fournisseur inutilement ;
- confondre document client et document interne.

## Résumé exécutable

Une IA ou un développeur doit appliquer cette règle :

```text
Chaque événement confirmé peut produire un document.
Chaque document doit prouver exactement un événement.
Chaque document doit être idempotent.
Chaque document doit être généré depuis des données figées.
```

La carte cible :

```text
payment_confirmed              -> facture
refund_confirmed               -> avoir / reçu de remboursement
wallet_movement_confirmed      -> reçu wallet
pickup_collected               -> preuve de retrait
purchase_order_created         -> bon fournisseur interne
```

Cette couche documentaire devient une colonne vertébrale de confiance pour Komerce.
