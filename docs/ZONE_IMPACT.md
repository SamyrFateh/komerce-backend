# Zone d'impact Komerce

> **Statut** : invariants critiques du projet  
> **Dernière consolidation** : 15 mai 2026  
> **Sources vérifiées** : `server.js`, `services/order-status-machine.js`, `services/pricing-engine.js`, `services/wallet-service.js`, `routes/payments.js`, `routes/scans.js`.  
> **But** : éviter les modifications qui cassent la cohérence métier, financière ou logistique.

---

## 1. Règle principale

Un changement peut sembler local, mais Komerce est un système à effets en chaîne : paiement, commande, colis, wallet, stock, relais, notifications et pricing sont liés.

Avant toute modification, identifier :

1. l'objet touché : produit, commande, colis, paiement, wallet, shipment, relais ;
2. la source de vérité ;
3. les effets secondaires ;
4. les écritures DB concernées ;
5. les notifications ou preuves client impactées.

---

## 2. Invariants absolus

| ID | Invariant | Source de vérité |
|---|---|---|
| **I-01** | Ne pas modifier `orders.status` hors machine de statut. | `services/order-status-machine.js` |
| **I-02** | Les paiements Stripe/cash/wallet/shared cart confirment uniquement `pending → confirmed`. | `transitionOrderStatus()` |
| **I-03** | Les transitions scan/système sont forward-only et idempotentes. | `isForwardTransition()` |
| **I-04** | Toute transition effective doit laisser une trace dans `order_status_history`. | `transitionOrderStatus()` |
| **I-05** | Le wallet ne se corrige pas par suppression ; on crédite, débite ou contre-passe. | `services/wallet-service.js` |
| **I-06** | Une annulation doit restaurer ce qui doit l'être : stock et wallet appliqué. | `transitionOrderStatus()` |
| **I-07** | Les webhooks Stripe doivent garder un body brut avant `express.json`. | `server.js` |
| **I-08** | Le pricing doit lire les composantes DB et ne pas redevenir un coefficient dur. | `services/pricing-engine.js` |
| **I-09** | Le colis est une unité opérationnelle autonome ; ne pas refaire dépendre tout le flux de la commande complète. | routes colis / scans / hub |
| **I-10** | Les codes de retrait et preuves de collecte sont des éléments de confiance, pas de simples champs UI. | `pickup`, `scans`, `parcel-security` |

---

## 3. Fichiers à haut risque

| Fichier | Risque |
|---|---|
| `server.js` | Montage des routes, middlewares, webhooks, fallback HTML. |
| `db.js` | Connexion PostgreSQL utilisée partout. |
| `services/order-status-machine.js` | Cohérence du cycle de vie commande. |
| `services/wallet-service.js` | Argent client, avoirs, idempotence, FIFO. |
| `services/pricing-engine.js` | Marges, coût complet, décisions de sourcing. |
| `routes/payments.js` | Stripe, cash, confirmation paiement. |
| `routes/scans.js` | Scans terrain, collecte, statut logistique. |
| `routes/orders.js` | Création et mutation commande. |
| `routes/shared-cart.js` | Panier partagé et paiement tiers. |
| `routes/collective-workspaces.js` | Workspace collectif et contributions. |
| `middleware/auth.js` | Autorisations. |
| `middleware/rate-limit.js` | Protection login, cash, scan collect, admin. |

---

## 4. Machine commande actuelle

Statuts connus :

```text
pending
pending_group_payment
confirmed
ordered
preparation
shipped
in_transit
available
collected
cancelled
refunded
```

Transitions manuelles strictes (`source = patch`) :

```text
pending                → confirmed | cancelled | pending_group_payment
pending_group_payment  → confirmed | cancelled | pending
confirmed              → ordered | cancelled
ordered                → preparation | cancelled
preparation            → shipped | cancelled
shipped                → in_transit | cancelled
in_transit             → available | cancelled
available              → collected | cancelled
cancelled              → refunded
collected              → terminal
refunded               → terminal
```

Sources de paiement :

```text
stripe_webhook
cash_confirm
wallet_full_payment
shared_cart_full_payment
```

Ces sources ne doivent faire qu'une chose : `pending → confirmed`. Toute autre situation doit être traitée comme no-op/idempotence ou erreur contrôlée.

---

## 5. Effets secondaires critiques

### Passage à `confirmed`

- met `payment_status = paid` pour les sources paiement reconnues ;
- rend la commande exploitable par la suite opérationnelle ;
- ne doit pas déclencher plusieurs fois les mêmes effets.

### Passage à `available`

- peut générer un `pickup_code` si absent ;
- rend la commande/partie de commande récupérable ;
- ne doit pas exposer un code faible ou bruteforçable sans protection.

### Passage à `cancelled`

- restaure le stock des `order_items` ;
- contre-passe le wallet appliqué via `wallet-service` ;
- trace la raison d'annulation si fournie.

### Passage à `refunded`

- doit rester terminal ;
- ne pas réactiver une commande remboursée.

---

## 6. Wallet

Principes à respecter :

- 1 wallet par utilisateur ;
- transactions immutables ;
- lots de crédits consommés FIFO ;
- idempotence via `idempotency_key` ;
- contrepassation plutôt que suppression ;
- ne jamais modifier `balance_kmf` sans transaction métier associée.

Toute modification wallet doit répondre à trois questions :

1. quelle transaction est créée ?
2. quel lot est consommé ou restauré ?
3. quelle clé d'idempotence empêche le double effet ?

---

## 7. Pricing

Ne pas casser :

- les 4 prix : survival, minimum safe, recommended, test market ;
- les statuts `health_status` ;
- les statuts `market_confidence` ;
- les décisions `sourcing_decision` ;
- la lecture DB des coûts, charges et provisions.

Interdiction de remplacer le moteur par :

```text
prix = coût × coefficient unique
```

Cela détruirait la doctrine économique Komerce.

---

## 8. Webhooks Stripe

Dans `server.js`, les routes webhook Stripe sont déclarées en `express.raw` avant `express.json` :

- `/api/payments/stripe/webhook` ;
- `/api/shared-carts/stripe/webhook` ;
- `/api/collective-payments/stripe/webhook`.

Ne pas déplacer ces lignes sous le parser JSON. Sinon la signature Stripe peut devenir invalide.

---

## 9. Logistique colis-first

Règles :

- le colis est l'unité terrain ;
- une commande peut avoir plusieurs colis ;
- les scans prouvent des événements, ils ne sont pas une simple UI ;
- le statut commande doit rester une agrégation ou une conséquence contrôlée, pas une écriture sauvage ;
- les routes legacy peuvent exister, mais les nouvelles évolutions doivent privilégier le modèle colis-first.

---

## 10. Checklist avant modification

Avant de modifier un fichier sensible :

1. Est-ce que cela touche `orders.status` ? Si oui, passer par `transitionOrderStatus()`.
2. Est-ce que cela touche paiement ou wallet ? Si oui, vérifier idempotence.
3. Est-ce que cela touche stock ? Si oui, vérifier transaction et restauration en annulation.
4. Est-ce que cela touche pickup/collecte ? Si oui, vérifier brute-force, preuve et audit.
5. Est-ce que cela touche pricing ? Si oui, vérifier doctrine économique.
6. Est-ce que cela touche webhook ? Si oui, vérifier body brut.
7. Est-ce que cela touche `server.js` ? Si oui, vérifier ordre des middlewares et routes.

---

## 11. Dette connue

- Les documents historiques peuvent encore mentionner `utils/parcelSync.js` ou `routes/orders.js` comme sources de vérité principales pour `orders.status`. La vérité actuelle est `services/order-status-machine.js`.
- Les chiffres de routes/endpoints des anciennes cartographies ne doivent plus être utilisés comme preuve.
- Les versions affichées divergent encore entre `package.json`, commentaire `server.js` et `/api/health`.
