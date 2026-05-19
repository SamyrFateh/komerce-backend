# 🛡️ Guide d'intégration — Validation des données

## Architecture

```
middleware/
  validate.js          ← Middleware validate() + sanitize()
validators/
  index.js             ← 31 schémas Joi (auth, products, orders, etc.)
```

## Installation

```bash
npm install joi
```

## Branchement sur les routes

### Exemple : auth.js (avant / après)

**Avant :**
```js
router.post('/register', async (req, res) => {
  const { email, password, full_name, phone } = req.body;
  // ... validation manuelle dispersée
```

**Après :**
```js
const { validate } = require('../middleware/validate');
const { auth } = require('../validators');

router.post('/register', validate(auth.register), async (req, res) => {
  const { email, password, full_name, phone } = req.body;
  // req.body est déjà sanitisé + validé ✅
```

## Routes à brancher

| Fichier | Route | Schéma |
|---------|-------|--------|
| **auth.js** | `POST /register` | `auth.register` |
| | `POST /login` | `auth.login` |
| | `PUT /me` | `auth.updateProfile` |
| | `POST /guest-checkout` | `auth.guestCheckout` |
| | `POST /auto-register` | `auth.autoRegister` |
| | `POST /orders-by-phone` | `auth.ordersByPhone` |
| | `POST /admin-reset` | `auth.adminReset` |
| **products.js** | `POST /` | `products.create` |
| | `PUT /:id` | `products.update` |
| | `DELETE /:id` | `products.delete` |
| **orders.js** | `POST /` | `orders.create` |
| | `PATCH /:id/status` | `orders.updateStatus` |
| | `PATCH /:id/cost` | `orders.updateCost` |
| **payments.js** | `POST /stripe/intent` | `payments.stripeIntent` |
| | `POST /cash/confirm` | `payments.cashConfirm` |
| **admin.js** | `POST /partners` | `admin.createPartner` |
| | `PUT /partners/:id` | `admin.updatePartner` |
| | `POST /reset` | `admin.reset` |
| | `POST /seed-test` | `admin.seedTest` |
| **baskets.js** | `POST /share` | `baskets.share` |
| | `PATCH /:code` | `baskets.updateBasket` |
| | `POST /gift` | `baskets.gift` |
| | `POST /gift/:code/confirm` | `baskets.giftConfirm` |
| **scans.js** | `POST /` | `scans.create` |
| | `POST /collect` | `scans.collect` |
| | `POST /hub/receive` | `scans.hubReceive` |
| | `POST /verify-qr` | `scans.verifyQr` |
| **modules.js** | `POST /price` | `modules.calculatePrice` |
| | `POST /fabrics` | `modules.createFabric` |
| | `POST /models` | `modules.createModel` |
| **logistics.js** | `POST /shipments` | `logistics.createShipment` |
| | `PATCH /shipments/:id` | `logistics.updateShipment` |

## Ce que ça protège

| Menace | Protection |
|--------|-----------|
| 💉 Injection SQL | Paramètres typés + stripUnknown |
| 🏷️ XSS stocké | sanitizeString() strip HTML/JS |
| 📏 Buffer overflow | max length sur tous les strings |
| 🔢 Division par zéro | Nombres positifs obligatoires |
| 🎭 Prototype pollution | Clés __proto__/constructor filtrées |
| 📭 Crash sur null/undefined | Champs required + defaults |
| 🗑️ Données poubelles | Trim + normalisation espaces |
| 📝 Types incohérents | Schéma strict (uuid, email, phone) |

## Réponse en cas d'erreur

```json
{
  "error": "Données invalides",
  "details": [
    { "source": "body", "field": "email", "message": "email doit être un email valide", "type": "string.email" },
    { "source": "body", "field": "items", "message": "items doit contenir au moins 1 élément(s)", "type": "array.min" }
  ],
  "hint": "Vérifiez les champs listés ci-dessous et réessayez."
}
```
