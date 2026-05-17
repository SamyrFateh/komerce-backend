# Zone d'impact Komerce

> **Statut** : invariants critiques du projet  
> **Dernière consolidation** : 17 mai 2026  
> **Sources vérifiées** : `server.js`, `services/order-status-machine.js`, `services/order-payment-confirmation.js`, `services/pricing-engine.js`, `services/wallet-service.js`, `routes/payments.js`, `routes/scans.js`, `routes/pickup-secret.js`.  
> **Mis à jour le 17 mai 2026** : I-02 étendu au paiement collectif, `order-payment-confirmation.js` ajouté, `collective_payment` ajouté, pickup rate-limit in-memory documenté. **SOCLE-3** : section 3 bis ajoutée pour détailler le risque spécifique de `server.js` (1200 lignes, 80 routes API, 92 DDL inline, 3 webhooks Stripe en body brut).
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
| **I-02** | Les paiements Stripe/cash/wallet/shared cart/**collectif** confirment uniquement `pending → confirmed`. | `transitionOrderStatus()` |
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
| `server.js` | **Point névralgique — voir §3 bis ci-dessous.** Montage de 80 routes API, ordre critique des middlewares, 3 webhooks Stripe en body brut (lignes 129-131), 92 instructions DDL inline, `setImmediate(fixMissingSchema)` au boot, fallback HTML, validation `REQUIRED_ENV`. 1200 lignes. |
| `db.js` | Connexion PostgreSQL utilisée partout. |
| `services/order-status-machine.js` | Cohérence du cycle de vie commande. |
| `services/wallet-service.js` | Argent client, avoirs, idempotence, FIFO. |
| `services/pricing-engine.js` | Marges, coût complet, décisions de sourcing. |
| `routes/payments.js` | Stripe, cash, confirmation paiement. |
| `services/order-payment-confirmation.js` | Point d'entrée unique du cycle paiement → stock. Déclenche la confirmation commande, le décrément stock et les notifications post-paiement. |
| `routes/scans.js` | Scans terrain, collecte, statut logistique. |
| `routes/orders.js` | Création et mutation commande. |
| `routes/shared-cart.js` | Panier partagé et paiement tiers. |
| `routes/collective-workspaces.js` | Workspace collectif et contributions. |
| `middleware/auth.js` | Autorisations. |
| `middleware/rate-limit.js` | Protection login, cash, scan collect, admin. |

---

## 3 bis. Le cas particulier de `server.js`

`server.js` cumule plusieurs responsabilités hétérogènes. Modifier ce fichier sans précaution peut casser le boot complet, l'idempotence des webhooks Stripe (I-07), ou la cohérence du schéma DB. Détails :

### Responsabilités cumulées (1200 lignes)

1. **Validation env (`REQUIRED_ENV`)** lignes ~18-21 — refus de boot si une variable manque.
2. **Webhooks Stripe en `express.raw`** lignes 129-131 — body brut **obligatoirement avant** `express.json` (invariant I-07).
3. **Montage des middlewares globaux** — `helmet`, `cors`, `cookie-parser`, `express.json` (limite 1 MB), `requestIdMiddleware`, rate limiting global et spécialisé.
4. **Montage de 80 routes API** — chaque `app.use('/api/...')` doit respecter l'ordre (rate limit avant route, auth avant payload sensible).
5. **92 instructions DDL inline** (CREATE TABLE / ALTER TABLE / ADD COLUMN) — c'est de la migration runtime ad-hoc, à terme déplaçable vers `scripts/fix-schema.js`. Cf. `SCHEMA_GAP_KOMERCE.md` §Architecture.
6. **Fallback HTML** pour les routes non-API (sert `public/boutique/index.html`).
7. **Boot HTTP + post-boot async** — `app.listen` puis `setImmediate(fixMissingSchema)` ligne ~592.

### Règles avant modification

- **Ne jamais déplacer les webhooks Stripe (lignes 129-131) après `express.json`.** Ça invalide la signature, les paiements deviennent silencieusement non confirmés.
- **Ne pas modifier l'ordre des middlewares globaux** sans valider que rate limit, auth et CORS s'appliquent toujours dans le bon ordre.
- **Ne pas ajouter de nouvelle route `/api/...` sans rate limit applicable** (vérifier le rate-limiter global + spécialisé).
- **Ne pas ajouter de DDL inline sans valider l'idempotence** (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`). Toute migration future doit privilégier `scripts/fix-schema.js` ou un fichier `migrations/*.sql`.
- **Ne pas remplacer `REQUIRED_ENV` par des fallbacks silencieux**. Le boot doit échouer fort, pas dégrader en silence.

### Vers où on veut aller (dette d'archi)

- Découpler le montage des routes (générer depuis un manifeste, ou utiliser `glob` sur `routes/`).
- Sortir les 92 DDL inline vers `scripts/fix-schema.js` ou un vrai runner de migrations.
- Réduire `server.js` à : env check, middlewares, montage de routes, boot. Cible : < 300 lignes.

C'est un chantier lourd (lot `H1` à programmer), pas un nettoyage rapide.

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
collective_payment
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
- ⚠️ le rate-limit anti-bruteforce du pickup secret est **in-memory** (`routes/pickup-secret.js` lignes 336 et 1110) — inefficace en multi-instance Railway. Non bloquant en mono-instance.

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
7. Est-ce que cela touche `server.js` ? Si oui, **lire §3 bis** : ne pas déplacer les webhooks Stripe sous `express.json`, ne pas ajouter de DDL non-idempotent, ne pas casser l'ordre des middlewares, ne pas ajouter de fallback silencieux sur `REQUIRED_ENV`.

---

## 11. Dette connue

- Les documents historiques peuvent encore mentionner `utils/parcelSync.js` ou `routes/orders.js` comme sources de vérité principales pour `orders.status`. La vérité actuelle est `services/order-status-machine.js`.
- Les chiffres de routes/endpoints des anciennes cartographies ne doivent plus être utilisés comme preuve.
- Les versions affichées divergent encore entre `package.json`, commentaire `server.js` et `/api/health`.
- **Pickup rate-limit in-memory** : `routes/pickup-secret.js` lignes 336 et 1110 — TODO explicites dans le code. À migrer vers Redis avant passage multi-instance (lot dédié à créer).
- **QR_SECRET fallback** : supprimé en lot D0 — s'assurer que la variable est bien configurée sur Railway avant merge.
- **`server.js` à 1200 lignes** : 92 instructions DDL inline + montage de 80 routes + fallback HTML + boot post-async. Refactor à programmer (lot `H1` futur). Cf. §3 bis.
