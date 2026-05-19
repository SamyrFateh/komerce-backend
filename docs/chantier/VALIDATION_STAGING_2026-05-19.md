# Validation staging / Railway — P0

> Date : 2026-05-19  
> Branche de référence auditée : `main`  
> Commit observé : `6d150bafb03ebd5fbee9bae06eda021c73cd31c7`  
> Verdict : **PARTIAL**

---

## 1. Verdict global

**PARTIAL**.

La validation documentaire/statique P0 est cohérente et la validation runtime a commencé :

- le cycle critique est clôturé ;
- I-SWEEP-1 → I-SWEEP-6C sont documentés comme terminés ;
- TEST-1A / TEST-1B sont présents dans le statut chantier ;
- le script de test Jest existe ;
- les variables d'environnement critiques déclarées par l'opérateur sont présentes ;
- le build Railway est passé ;
- le conteneur Railway a démarré ;
- l'API annonce `KOMERCE API v12.4 — port 8080` ;
- les migrations background et seeds visibles dans les logs sont passés ;
- les webhooks Stripe sont encore montés en body brut avant `express.json`.

La validation P0 complète exige encore :

- `npm test` réel ;
- appels HTTP `/health` ou `/api/health` ;
- flows HTTP/curl staging sur les flows 1 à 9.

Aucun bug bloquant code n'est confirmé dans cette session. Le verdict reste donc **PARTIAL**, mais avec **boot Railway validé**.

---

## 2. Commandes / preuves runtime disponibles

### Railway boot fourni par opérateur

Extrait fourni :

```text
> npm run build && node server.js
> komerce-backend@10.6.1 build
> node public/boutique/scripts/bundle-css.js
  ✓  base.css           1262 lignes
  ✓  components.css     4500 lignes
  ✓  desktop.css        1860 lignes
  ✓  event.css          1146 lignes
  Total : 8720 → 8768 lignes dans css/dist/
[RateLimit] ℹ️  REDIS_URL absent — store mémoire (mono-instance)
> komerce-backend@10.6.1 start
Starting Container
⚠️  Legacy SMS désactivé — canal cible : WhatsApp/AuthKey
[CollectivePay] cron expiration started, interval=300s
KOMERCE API v12.4 — port 8080 — démarrage immédiat — migrations en background
🔒 ADMIN_PASSWORD défini — migration du hash admin
⏰ Cash reminder cron: every 60min
✅ Wallet tables ready
[HUB-DASH] Tables + migrations OK
[SECURITY] ✅ Security tables ready
🔧 Running schema migrations...
🔧 Schema migrations complete.
[seed] Admin already exists, skipping
[seed] Products already seeded (128468), skipping
[seed] ✅ All seeds completed
...
✅ Migration 052: charges already seeded, skipping
```

Conclusion : **boot Railway PASS sur logs fournis**.

### Commandes encore à lancer pour passer de PARTIAL à PASS

```bash
npm test
```

Puis, sur staging/Railway :

```bash
curl /health
curl /api/health
```

Et les flows métier listés en section 5.

---

## 3. Résultats tests Jest

### Statique depuis le repo

`package.json` expose :

```json
"test": "jest --runInBand --forceExit --detectOpenHandles"
```

Les tests ajoutés par TEST-1A/1B sont documentés dans `STATUS.md` :

- `tests/integration/isweep-invariants.test.js`
- `tests/integration/isweep-services.test.js`
- `tests/integration/isweep-transactional-flows.test.js`
- `tests/integration/test-harness/mock-db.js`

### Exécution réelle

Non exécutée dans cette session.

| Fichier | Résultat |
|---------|----------|
| `tests/integration/isweep-invariants.test.js` | NON EXÉCUTÉ |
| `tests/integration/isweep-services.test.js` | NON EXÉCUTÉ |
| `tests/integration/isweep-transactional-flows.test.js` | NON EXÉCUTÉ |

Action requise : lancer `npm test` localement ou en CI.

---

## 4. Résultats boot Railway / local

### Variables d'environnement

Présence déclarée par opérateur :

| Variable | Statut |
|----------|--------|
| `DATABASE_URL` | présent |
| `JWT_SECRET` | présent |
| `STRIPE_SECRET_KEY` | présent |
| `STRIPE_WEBHOOK_SECRET` | présent |
| `STRIPE_SHARED_CART_WEBHOOK_SECRET` | présent |
| `STRIPE_COLLECTIVE_WEBHOOK_SECRET` | présent |

Variables fatales au boot dans `server.js` :

```js
const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET'];
```

Variables recommandées non fatales :

```js
const RECOMMENDED_ENV = ['ADMIN_PASSWORD', 'STRIPE_SECRET_KEY'];
```

### Build / boot

Le boot attendu par `package.json` est :

```bash
npm run build && node server.js
```

Le log Railway fourni confirme :

- build CSS exécuté ;
- 4 bundles CSS générés ;
- conteneur démarré ;
- API lancée sur port 8080 ;
- migrations background exécutées ;
- seeds exécutés ou ignorés proprement.

Résultat : **PASS sur logs Railway fournis**.

### Webhooks Stripe

Les routes Stripe raw body sont montées avant `express.json` :

```js
app.use('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }));
app.use('/api/shared-carts/stripe/webhook', express.raw({ type: 'application/json' }));
app.use('/api/collective-payments/stripe/webhook', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '1mb' }));
```

---

## 5. Résultats par flow

| # | Flow | Statut P0 | Notes |
|---|------|-----------|-------|
| 1 | Cash pickup | NON EXÉCUTÉ | À tester sur `/api/pickup/pay-cash/:orderId`. TEST-1A/1B couvrent le branchement et le comportement transactionnel mocké. |
| 2 | QR verify | NON EXÉCUTÉ | À tester sur `/api/scans/verify-qr`. Vérification statique antérieure : sync parcels avant commit. |
| 3 | Stripe intent | NON EXÉCUTÉ | À tester sur `/api/payments/stripe/intent`. Doit réutiliser l'intent existant ou créer avec idempotency key. |
| 4 | Purchasing trigger | NON EXÉCUTÉ | À tester par passage commande en `ordered` ou appel service contrôlé. Doit éviter les POs doublons. |
| 5 | Purchasing receive | NON EXÉCUTÉ | À tester sur `/api/purchasing/:id/receive`. TEST-1B couvre commit/rollback avec mock DB. |
| 6 | Collective repairs | NON EXÉCUTÉ | À tester en dry-run sur endpoints admin `repair-ready-to-capture` et `repair-stock-reservations`. |
| 7 | Refund admin | NON EXÉCUTÉ | À tester en dry-run sur `/api/admin/orders/:orderId/refund`. Ne doit pas exécuter de refund sans `dry_run:false`. |
| 8 | Pricing apply | NON EXÉCUTÉ | À tester sur `apply-price` et `apply-all`. Doit refuser sous survival serveur et auditer price_history. |
| 9 | Product publication | NON EXÉCUTÉ | À tester via `POST/PUT /api/products`. Doit refuser incohérences prix/stock et auditer stock. |

---

## 6. Bugs bloquants détectés

Aucun bug bloquant confirmé.

Le boot Railway est validé sur logs fournis.

---

## 7. Bugs non bloquants détectés

Aucun bug code confirmé.

Points d'attention :

- `REDIS_URL` est absent : le rate-limit utilise un store mémoire mono-instance. C'est acceptable pour validation, mais à durcir si scaling multi-instance.
- P0 ne peut pas être marqué PASS sans `npm test` réel et tests HTTP staging.

---

## 8. Prochain lot recommandé selon verdict

Verdict : **PARTIAL**.

Recommandation :

1. Lancer `npm test` localement ou en CI.
2. Tester `/health` ou `/api/health` sur l'URL Railway.
3. Tester en priorité les endpoints dry-run/non destructifs :
   - `POST /api/admin/collective/repair-ready-to-capture` avec `dry_run:true` ;
   - `POST /api/admin/collective/repair-stock-reservations` avec `dry_run:true` ;
   - `POST /api/admin/orders/:orderId/refund` avec `dry_run:true`.
4. Si tout passe et que les flows staging passent, produire une nouvelle version de ce rapport avec verdict **PASS** et cocher P0 dans `STATUS.md`.
5. Si un test ou flow échoue, ouvrir un lot de correction ciblé avant tout autre chantier.

---

## Conclusion

P0 est bien avancé mais non clôturé.

Le backend boot correctement sur Railway avec les variables critiques présentes. Il reste à exécuter Jest et les endpoints HTTP staging pour obtenir un verdict PASS complet.
