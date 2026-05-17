# D7 — Audit CORS production

> Date : 2026-05-17
> Scope : audit/documentation uniquement

## Résumé

Audit de la configuration CORS dans `server.js`.

Aucune modification de code n'a été appliquée dans ce lot afin de ne pas bloquer les pages existantes.

## Configuration constatée

`server.js` définit :

```js
const FRONTEND_URL = process.env.FRONTEND_URL || '';
```

La fonction `isAllowedOrigin(origin)` accepte :

1. les requêtes sans `Origin` ;
2. `http://localhost` et `https://localhost`, avec ou sans port ;
3. l'origine exactement égale à `FRONTEND_URL` ;
4. les origines listées dans `ALLOWED_ORIGINS`, séparées par virgule.

Les options CORS autorisent :

- méthodes : `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS` ;
- credentials : `true`.

## Garanties constatées

- Pas de wildcard `*` avec credentials.
- Les origines non listées sont rejetées.
- `ALLOWED_ORIGINS` permet plusieurs frontends sans modifier le code.
- Les requêtes sans `Origin` sont acceptées, ce qui est utile pour curl, health checks, webhooks serveur-à-serveur ou clients non navigateur.
- Localhost est accepté pour le développement.

## Risques et limites

### 1. Localhost accepté même en production

La règle localhost est globale. Ce n'est pas critique en soi, mais ce n'est pas une politique production stricte.

Action recommandée : si nécessaire, limiter localhost à `NODE_ENV !== 'production'` dans un lot dédié, après vérification des usages admin/dev.

### 2. `credentials: true` impose une liste d'origines fiable

Comme les cookies sont acceptés, `FRONTEND_URL` et `ALLOWED_ORIGINS` doivent être strictement contrôlés en production.

Action recommandée : documenter les domaines exacts autorisés dans Railway.

### 3. Comparaison exacte des origines

`FRONTEND_URL` et `ALLOWED_ORIGINS` utilisent une comparaison stricte. Un slash final ou une différence de port casse l'autorisation.

Action recommandée : normaliser les valeurs dans la documentation d'exploitation : pas de slash final, protocole inclus.

### 4. Requêtes sans Origin acceptées

C'est courant côté API et webhooks, mais cela signifie que CORS n'est pas utilisé comme mécanisme d'authentification. C'est correct : CORS ne remplace pas auth, rate limiting et signatures.

### 5. Pages statiques servies par le même backend

La boutique et les pages admin peuvent être servies depuis le même domaine backend. Dans ce cas, CORS est moins critique pour ces pages, mais reste important pour un frontend séparé.

## Conclusion D7

D7 est validé côté audit.

Aucun problème critique nécessitant correction immédiate n'a été trouvé.

La configuration actuelle est acceptable pour MVP si les variables Railway `FRONTEND_URL` et `ALLOWED_ORIGINS` sont propres.

## Recommandations de suite

1. Vérifier les domaines exacts Railway / production.
2. Ne jamais mettre `*` dans `ALLOWED_ORIGINS` avec credentials.
3. Éviter les slashs finaux dans les origines.
4. En lot futur, envisager de refuser localhost en production si aucun besoin réel.
