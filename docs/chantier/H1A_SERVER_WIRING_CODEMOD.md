# H1A — Codemod de câblage `server.js`

> Date : 2026-05-19  
> Script : `scripts/h1a-wire-api-routes.js`  
> Statut : outillage préparatoire, n'applique rien tant qu'il n'est pas lancé localement.

---

## Objectif

Câbler le manifest `bootstrap/api-routes.js` dans `server.js` avec un diff local contrôlable.

Le connecteur GitHub remplace les fichiers complets via `update_file`, ce qui est trop risqué pour `server.js` (~1 200 lignes, webhooks raw Stripe, routes HTML, crons, migrations inline). Le script permet donc d'appliquer la transformation localement, puis de vérifier le diff avant PR.

---

## Commandes

Validation sans écriture :

```bash
node scripts/h1a-wire-api-routes.js --check
```

Application locale :

```bash
node scripts/h1a-wire-api-routes.js --write
```

Vérification obligatoire :

```bash
git diff -- server.js
npm test
npm run test:p0
```

Avec Railway si disponible :

```bash
P0_BASE_URL=<url-railway> npm run test:p0
```

---

## Ce que le script remplace

1. Le bloc d'import routes API dans `server.js` par :

```js
const {
  mountApiRoutesBeforeStripeOwnedBlocks,
  mountApiRoutesAfterStripeOwnedBlocks,
} = require('./bootstrap/api-routes');
```

2. Le premier bloc de montage API, avant les blocs Stripe-owned, par :

```js
mountApiRoutesBeforeStripeOwnedBlocks(app);
```

3. Le second bloc de montage API, après les blocs Stripe-owned, par :

```js
mountApiRoutesAfterStripeOwnedBlocks(app);
```

---

## Ce que le script ne touche pas

- Webhooks raw Stripe :
  - `/api/payments/stripe/webhook`
  - `/api/shared-carts/stripe/webhook`
  - `/api/collective-payments/stripe/webhook`
- `express.json`
- `sharedCart.stripeWebhookHandler`
- `collectiveWS.stripeWebhookHandler`
- cron collectif `startExpirationCron`
- routes HTML / SPA fallback
- crons cash/backorder
- migrations inline
- listen/shutdown

---

## Garde-fous intégrés

Le script échoue si :

- `server.js` semble déjà câblé ;
- un marqueur de bloc n'est pas trouvé ;
- un marqueur apparaît plus d'une fois ;
- une zone sensible disparaît après transformation ;
- les anciens blocs de routes API restent présents.

---

## Statut H1A

```text
H1A-0 = ✅ manifest ajouté
H1A-1 = 🟡 codemod prêt, câblage server.js non appliqué dans cette PR
```

Le vrai passage de H1A à terminé nécessite une PR suivante contenant le diff `server.js` généré localement par ce script et validé par tests.
