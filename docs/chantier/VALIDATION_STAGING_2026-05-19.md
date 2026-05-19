# Validation staging / Railway — P0

> Date : 2026-05-19  
> Branche de référence auditée : `main`  
> Commit observé : `6d150bafb03ebd5fbee9bae06eda021c73cd31c7`  
> Verdict : **PARTIAL**

---

## 1. Verdict global

**PARTIAL**.

La validation documentaire/statique P0 est cohérente :

- le cycle critique est clôturé ;
- I-SWEEP-1 → I-SWEEP-6C sont documentés comme terminés ;
- TEST-1A / TEST-1B sont présents dans le statut chantier ;
- le script de test Jest existe ;
- le boot serveur vérifie les variables fatales `DATABASE_URL` et `JWT_SECRET` ;
- les webhooks Stripe sont encore montés en body brut avant `express.json`.

Mais la validation P0 complète exige des exécutions que le connecteur GitHub ne peut pas faire seul :

- `npm test` réel ;
- `npm start` réel ;
- boot Railway réel ;
- appels HTTP/curl staging sur les flows 1 à 9.

Aucun bug bloquant code n'est confirmé dans cette session. Le verdict reste donc **PARTIAL par limitation d'environnement**, pas FAIL.

---

## 2. Commandes lancées

Aucune commande runtime n'a été lancée dans cette session, car l'accès disponible est le connecteur GitHub et non un clone local/Railway shell.

Commandes à lancer pour passer de PARTIAL à PASS :

```bash
npm test
npm start
```

Puis, sur staging/Railway avec variables d'environnement configurées :

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

### Statique depuis `server.js`

Variables fatales au boot :

```js
const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET'];
```

Variables recommandées non fatales :

```js
const RECOMMENDED_ENV = ['ADMIN_PASSWORD', 'STRIPE_SECRET_KEY'];
```

Le boot attendu par `package.json` est :

```bash
npm run build && node server.js
```

Le build exécute :

```bash
node public/boutique/scripts/bundle-css.js
```

### Webhooks Stripe

Les routes Stripe raw body sont montées avant `express.json` :

```js
app.use('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }));
app.use('/api/shared-carts/stripe/webhook', express.raw({ type: 'application/json' }));
app.use('/api/collective-payments/stripe/webhook', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '1mb' }));
```

### Exécution réelle

Non exécutée dans cette session.

Résultat : **NON EXÉCUTÉ**.

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

Blocage P0 : environnement d'exécution non disponible dans cette session GitHub-only.

---

## 7. Bugs non bloquants détectés

Aucun bug code confirmé.

Points d'attention :

- P0 ne peut pas être marqué PASS sans exécution réelle des tests et du boot.
- La validation staging doit être relancée depuis un environnement capable d'exécuter `npm test`, `npm start` et des `curl` vers Railway.

---

## 8. Prochain lot recommandé selon verdict

Verdict : **PARTIAL**.

Recommandation :

1. Ne pas lancer PRICE-1, A4, F1A ou H1 avant d'avoir exécuté la validation runtime.
2. Lancer localement ou en CI :

```bash
npm test
npm start
```

3. Si tout passe et que les flows staging passent, produire une nouvelle version de ce rapport avec verdict **PASS** et cocher P0 dans `STATUS.md`.
4. Si un test ou flow échoue, ouvrir un lot de correction ciblé avant tout autre chantier.

---

## Conclusion

P0 est initialisé mais non clôturé.

Le backend semble cohérent statiquement avec le cycle post-critique, mais la validation runtime reste à faire pour obtenir un verdict PASS.
