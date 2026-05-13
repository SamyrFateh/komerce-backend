# Delta backend — Panier collectif Komerce

## 1. Constat

Le backend panier collectif existe déjà.

Modules identifiés :

```txt
routes/collective-workspaces.js
services/collective-workspace-engine.js
services/collective-payment-orchestrator.js
```

Fonctionnalités déjà présentes :

```txt
- création de workspace collectif
- token public + token créateur
- items snapshotés
- contributions / intentions
- finalisation en session de paiement
- tokens de paiement individuels
- carte Stripe avec PaymentIntent manual capture
- confirmation cash par admin / agent_relais
- idempotence Stripe via stripe_events_processed
- création de commande depuis session collective
```

Donc le sujet n'est pas de recréer un backend parallèle.

Le sujet est d'aligner l'existant avec la doctrine validée :

```txt
Panier collectif = réservation + contributions
Commande finale seulement après validation/clôture explicite
```

## 2. Écart majeur avec la doctrine

Aujourd'hui, l'orchestrateur fait encore :

```txt
100% sécurisé → capture/confirmation → création automatique de commande
```

Dans `services/collective-payment-orchestrator.js` :

```txt
onPaymentAuthorized()
  → si amount_secured_kmf >= total_to_pay_kmf
  → status ready_to_capture
  → captureAllAndCreateOrder(session.id)
```

Et côté cash :

```txt
confirmCashContribution()
  → si reached100
  → _createOrderFromSession(...)
```

C'est robuste techniquement, mais ce n'est pas encore la doctrine cible.

Doctrine cible :

```txt
100% sécurisé → ready_to_order
organisateur clôture → création commande
```

## 3. Pourquoi ne pas patcher brutalement

`collective-payment-orchestrator.js` est un fichier sensible :

```txt
- Stripe manual capture
- cash relais
- création order
- décrément stock
- notifications
- purchasing
- idempotence
- cron expiration
```

Un patch massif peut casser :

```txt
- capture carte
- cash confirmé relais
- transition order_status
- triggerPurchasing
- notifications
- workflow Stripe webhook
```

Il faut donc faire évoluer par petites PR.

## 4. Séquence de correction recommandée

### PR A — État ready_to_order sans commande automatique

Objectif : séparer financement atteint et commande créée.

Changements :

```txt
- remplacer l'appel automatique à captureAllAndCreateOrder côté webhook par un passage en ready_to_order
- remplacer l'appel automatique à _createOrderFromSession côté cash par un passage en ready_to_order
- retourner au frontend : reached_100=true, ready_to_order=true, order_id=null
```

Attention carte Stripe :

Le paiement carte actuel est une autorisation manuelle Stripe.

Il faut décider :

```txt
Option 1 : autorisations carte capturées seulement à la clôture organisateur
Option 2 : captures dès 100%, mais commande uniquement à la clôture
```

Doctrine recommandée :

```txt
Option 1 si Stripe permet encore la fenêtre de capture.
Option 2 si la fenêtre de capture est trop courte ou risquée.
```

Pour Komerce V1, l'option 2 peut être plus sûre opérationnellement :

```txt
100% atteint → capturer les cartes → session funded_paid → attendre clôture commande
```

Mais il faut alors bien distinguer :

```txt
argent capturé ≠ commande créée
```

### PR B — Endpoint de clôture explicite

Ajouter :

```txt
POST /api/collective-workspaces/:creatorToken/close
```

Rôle :

```txt
- vérifier workspace trouvé
- vérifier session financée
- vérifier order_id NULL
- vérifier stock disponible / réservé
- appeler la création order existante
- lier order_id
```

Réponse :

```json
{
  "ok": true,
  "workspace_status": "order_created",
  "order_id": "...",
  "order_reference": "..."
}
```

### PR C — Réservation stock temporaire

Ajouter la table ou réutiliser un mécanisme existant si présent :

```txt
collective_stock_reservations
```

Colonnes :

```txt
id
workspace_id
product_id
quantity
status: reserved | consumed | released | expired
reserved_until
created_at
consumed_at
released_at
expired_at
```

Au moment de la finalisation :

```txt
SELECT products FOR UPDATE
vérifier stock disponible réel - réservations actives
créer réservations
```

Au moment de la commande :

```txt
reservation reserved → consumed
stock décrémenté définitivement
```

À expiration / annulation :

```txt
reservation reserved → released/expired
```

### PR D — Clarification cash

Aujourd'hui, le token avant confirmation cash est `active`, puis devient `paid` à l'encaissement relais.

On peut conserver la DB existante en V1, mais exposer des statuts métier plus clairs :

```txt
active + method=cash → cash_promised
paid + method=cash → cash_collected
```

Si la méthode cash n'est pas encore stockée explicitement dans `collective_payment_tokens`, ajouter :

```txt
payment_method: card | cash
cash_code
cash_relais_id
cash_collected_at
cash_collected_by
```

## 5. Règles de sécurité à conserver

Ne pas supprimer :

```txt
- SELECT FOR UPDATE sur sessions/tokens/workspaces
- idempotence Stripe
- contrôle agent_relais vs relais_id
- token hashé
- order_id comme frontière irréversible
- workspace_locked_by_order
```

## 6. Décision produit actée

Le participant cash ne paie pas dans l'app.

Il crée ou utilise une référence cash, puis l'agent relais encaisse.

```txt
participant → cash promis / référence
agent relais → cash collecté
organisateur → clôture commande
```

## 7. Prochain patch conseillé

Commencer par une PR très ciblée :

```txt
feat/collective-ready-to-order
```

Contenu :

```txt
1. Ajouter une fonction markSessionReadyToOrder(sessionId)
2. Remplacer les auto-créations commande par markSessionReadyToOrder
3. Ajouter POST /api/collective-workspaces/:creatorToken/close
4. Réutiliser _createOrderFromSession uniquement dans close
```

Si le fichier orchestrator est trop gros pour un patch sûr via outil, faire localement avec ce delta précis.

## 8. Résumé

Backend existant : bon socle.

Correction nécessaire :

```txt
Financé / sécurisé ≠ Commande créée
```

La commande collective doit devenir :

```txt
financement atteint
+ stock garanti
+ clôture explicite
= commande ferme
```
