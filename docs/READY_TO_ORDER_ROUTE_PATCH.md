# Patch route nécessaire — ready_to_order

Le wrapper `services/collective-ready-to-order-orchestrator.js` est ajouté.

Pour activer entièrement la doctrine, `routes/collective-workspaces.js` doit remplacer :

```js
const orchestrator = require('../services/collective-payment-orchestrator');
```

par :

```js
const orchestrator = require('../services/collective-ready-to-order-orchestrator');
```

Effet :

- webhook carte `onPaymentAuthorized()` ne crée plus automatiquement une commande ;
- confirmation cash `confirmCashContribution()` ne crée plus automatiquement une commande ;
- à 100%, la session/workspace passe en `ready_to_order` ;
- `order_id` reste `null` jusqu'à clôture explicite.

Message route cash à ajuster ensuite :

```js
message: result.reached_100
  ? 'Toutes les parts sont confirmées — panier prêt à commander.'
  : 'Part cash confirmée.'
```

Endpoint cible à brancher :

```txt
POST /api/collective-workspaces/:creatorToken/close
```

En V1 de cette PR, le wrapper expose `closeReadyToOrderByCreator()` comme garde-fou. La création effective de commande par clôture doit être branchée dans la PR suivante en exposant `_createOrderFromSession` ou un service public dédié.
