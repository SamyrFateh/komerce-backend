# D6 — Audit rate limiting exhaustif

> Date : 2026-05-17
> Scope : audit/documentation uniquement

## Résumé

Audit du middleware `middleware/rate-limit.js` et des montages dans `server.js`.

Aucune modification de quota ni de logique applicative n'a été appliquée dans ce lot.

## Garanties constatées

### Store

- Si `REDIS_URL` est défini, le rate limiting utilise Redis via `rate-limit-redis`.
- Sinon, le serveur démarre avec un store mémoire local.
- La connexion Redis est non bloquante : un échec Redis ne bloque pas le boot.
- Chaque limiter a un préfixe distinct : `global`, `auth`, `cash`, `scan`, `order-create`, `dashboard`, `admin`.

### Limiteurs déclarés

| Limiter | Fenêtre | Quota | Montage |
|---------|---------|-------|---------|
| `globalLimiter` | 15 min | 500/IP | `/api/` |
| `authLimiter` | 15 min | 20/IP | `/api/auth/login`, `/api/auth/register` |
| `cashConfirmLimiter` | 1 min | 3/IP | `/api/payments/cash/confirm` |
| `scanCollectLimiter` | 1 min | 5/IP | `/api/scans/collect` |
| `orderCreateLimiter` | 1 min | 10/IP | `POST /api/orders` |
| `dashboardLimiter` | 1 min | 60/IP | `/api/dashboard` |
| `adminLimiter` | 1 min | 300/IP | `/api/admin/`, sauf GET |

### Couverture serveur

`server.js` monte les limiters avant les routeurs API principaux :

- global sur `/api/`
- auth sur login/register
- cash confirm
- scan collect
- création commande
- dashboard
- admin

## Points forts

- Les routes API sont toutes au moins couvertes par le global limiter.
- Les endpoints de connexion ont un limiter dédié.
- La création commande a un limiter dédié.
- Le retrait classique `/api/scans/collect` a un limiter dédié.
- Les écritures admin ont un limiter dédié.
- Les webhooks Stripe sont sous `/api/`, donc couverts par le global limiter tout en conservant le raw body avant `express.json`.

## Risques et limites

### 1. Redis absent = protection mono-instance seulement

Si `REDIS_URL` n'est pas configuré en prod multi-instance, les quotas sont appliqués par process et non globalement.

Action recommandée : documenter `REDIS_URL` comme recommandé prod dans D5 / `.env.example`.

### 2. Admin GET illimités

`adminLimiter` ignore les GET. C'est volontaire pour éviter de casser les dashboards, mais cela laisse les lectures admin lourdes dépendre du seul `globalLimiter`.

Action recommandée : garder tel quel pour l'instant, puis envisager un limiter lecture admin plus large si certains endpoints deviennent coûteux.

### 3. Webhooks Stripe seulement protégés par global limiter

Les webhooks Stripe sont couverts par `/api/`, mais pas par un limiter dédié. C'est acceptable car Stripe peut retry et la signature + idempotence font foi.

Action recommandée : ne pas ajouter de limiter agressif sur webhooks sans mesurer l'impact sur les retries Stripe.

### 4. `/api/scans/verify-qr` pas de limiter dédié

Le QR retrait passe par rôle `admin` ou `agent_relais`, mais n'a pas de limiter dédié équivalent à `scanCollectLimiter`.

Action recommandée : envisager un limiter dédié modéré pour `/api/scans/verify-qr`, séparé de D6 si correction code.

### 5. Endpoints publics shared-cart

`GET /api/shared-carts/public/:token` et `POST /api/shared-carts/public/:token/contributions` sont couverts par global limiter uniquement.

Action recommandée : surveiller. Un limiter spécifique contribution peut être utile si abus ou scraping.

### 6. Rate limiting par IP uniquement

Les limiters actuels utilisent la clé IP par défaut. Avec `app.set('trust proxy', 1)`, Express doit lire correctement l'IP Railway/proxy, mais cela reste à valider en prod.

Action recommandée : vérifier les headers Railway et éventuellement définir un `keyGenerator` adapté pour certains endpoints sensibles.

## Conclusion D6

D6 est validé côté audit.

Aucun trou critique nécessitant correction immédiate n'a été confirmé.

Les corrections potentielles doivent rester en lots séparés pour éviter de durcir brutalement les quotas :

1. limiter dédié `/api/scans/verify-qr` ;
2. limiter modéré pour contributions shared-cart ;
3. stratégie admin GET si endpoints coûteux ;
4. Redis obligatoire ou fortement recommandé en prod multi-instance.
