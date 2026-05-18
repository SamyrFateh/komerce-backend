# I-SWEEP-1 — Patch `/pay-cash` pickup-secret

> Date : 2026-05-18
> État : service transactionnel créé, branchement route à appliquer prudemment

## Service créé

Fichier : `services/confirm-pickup-cash-payment.js`

Ce service corrige le cœur métier :

- transaction `BEGIN/COMMIT/ROLLBACK` ;
- `SELECT ... FOR UPDATE` sur `orders` ;
- cross-relais strict pour `agent_relais` ;
- passage par `confirmPaymentCycle(...)` ;
- rollback si stock insuffisant ;
- génération du pickup secret dans la même transaction ;
- `cash_collections ON CONFLICT DO NOTHING` ;
- retour du code clair une seule fois.

## Branchement à faire dans `routes/pickup-secret.js`

### 1. Ajouter le require

Après :

```js
const { transitionOrderStatus } = require('../services/order-status-machine');
```

ajouter :

```js
const { confirmPickupCashPayment } = require('../services/confirm-pickup-cash-payment');
```

### 2. Remplacer le handler `/pay-cash/:orderId`

Remplacer entièrement le bloc :

```js
router.post('/pay-cash/:orderId', authenticate, requireRelaisOrAdmin, async (req, res, next) => {
  ...ancien handler...
});
```

par :

```js
router.post('/pay-cash/:orderId', authenticate, requireRelaisOrAdmin, async (req, res, next) => {
  try {
    const result = await confirmPickupCashPayment({
      orderId: req.params.orderId,
      user: req.user,
      payload: req.body,
      generateAndStoreSecret,
    });

    if (result.status !== 200) {
      return res.status(result.status).json(result.body);
    }

    const printToken = crypto.randomBytes(24).toString('hex');
    printTokens.set(printToken, {
      orderId: result.body.order_id,
      code: result.body.code,
      payer_name: result.body.payer_name,
      expires_at: Date.now() + 2 * 60 * 1000,
    });

    res.json({
      success: true,
      message: result.body.message,
      code: result.body.code,
      print_token: printToken,
      order_ref: result.body.order_ref,
      amount_kmf: result.body.amount_kmf,
    });

    // Post-commit hooks non bloquants.
    try {
      const loyaltyService = require('../services/loyalty-service');
      loyaltyService.handleOrderConfirmed({ orderId: result.body.order_id })
        .then(r => { if (r && !r.skipped) console.log('[loyalty] hook OK:', r); })
        .catch(e => console.warn('[loyalty] hook error:', e.message));
    } catch (_) { /* non-bloquant */ }

    try {
      const { triggerPurchasing } = require('./purchasing');
      triggerPurchasing(result.body.order_id)
        .then(r => console.log('[PURCHASING] Pickup cash trigger OK:', result.body.order_ref, r))
        .catch(e => console.error('[PURCHASING] Pickup cash trigger error:', result.body.order_ref, e.message));
    } catch (e) {
      console.error('[PICKUP-CASH-POSTCOMMIT] triggerPurchasing load error:', e.message);
    }
  } catch (err) {
    next(err);
  }
});
```

## Pourquoi ce branchement corrige I-01

L'ancien handler faisait :

```sql
status = 'confirmed'
payment_status = 'paid'
confirmed_at = $3
```

directement dans `orders`.

Le nouveau chemin délègue à :

```js
confirmPaymentCycle(...)
```

qui appelle :

```js
transitionOrderStatus(...)
```

pour `pending → confirmed`, puis `confirmed → ordered`, et décrémente le stock dans la même transaction.

## Tests minimaux à exécuter après branchement

1. Cash pickup nominal :
   - commande `cash_relais` pending ;
   - appel `/api/pickup/pay-cash/:orderId` ;
   - order passe `ordered` ;
   - `payment_status = paid` ;
   - `order_status_history` contient `confirmed` et `ordered` ;
   - stock décrémenté ;
   - pickup secret créé.

2. Replay :
   - second appel `/pay-cash` ;
   - réponse 409 ;
   - pas de double décrément stock.

3. Stock insuffisant :
   - réponse 409 ;
   - pas de secret créé ;
   - pas de cash_collection ;
   - pas de statut confirmed.

4. Cross-relais :
   - agent d'un autre relais ;
   - réponse 403 ;
   - alerte créée ;
   - aucun effet DB métier.

## Décision

Le patch n'a pas été appliqué automatiquement dans cette passe car `routes/pickup-secret.js` est un fichier long et sensible. Le service transactionnel est commité ; le branchement route doit être appliqué soit localement, soit par un patch ciblé sûr avec tests immédiats.
