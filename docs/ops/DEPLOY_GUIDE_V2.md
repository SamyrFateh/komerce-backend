# 🚀 Vague 2 — Guide de Déploiement

## Fichiers modifiés/ajoutés

| Fichier | Action | Item |
|---------|--------|------|
| `routes/admin.js` | MODIFIÉ | V2.1 — Password reset sécurisé |
| `middleware/request-id.js` | NOUVEAU | V2.2 — Request ID correlation |
| `middleware/error-handler.js` | MODIFIÉ | V2.2 — Request ID dans erreurs |
| `routes/hub.js` | MODIFIÉ | V2.3 — Batch scan + search + stats/week |
| `db.js` | MODIFIÉ | V2.8 — Pool optimization |
| `tests/unit/order-status-machine.test.js` | NOUVEAU | V2.4 |
| `tests/unit/validators.test.js` | NOUVEAU | V2.5 |
| `tests/unit/wallet-service.test.js` | NOUVEAU | V2.5 |
| `tests/integration/api.test.js` | NOUVEAU | V2.6 |
| `jest.config.js` | NOUVEAU | V2.7 |
| `.github/workflows/ci.yml` | NOUVEAU | V2.7 |

## Étapes de déploiement

### 1. Installer les dépendances test
```bash
npm install --save-dev jest supertest
```

### 2. Ajouter les scripts dans package.json
```json
{
  "scripts": {
    "test": "jest --forceExit --detectOpenHandles",
    "test:unit": "jest tests/unit/ --forceExit",
    "test:integration": "jest tests/integration/ --forceExit --detectOpenHandles",
    "test:coverage": "jest --coverage --forceExit --detectOpenHandles"
  }
}
```

### 3. Monter le request-id middleware dans server.js
```javascript
// APRÈS les imports, AVANT les routes:
const { requestIdMiddleware } = require('./middleware/request-id');
app.use(requestIdMiddleware);
```

### 4. Vérifier
```bash
npm run test:unit       # Tests rapides (pas de DB)
npm run test:coverage   # Avec rapport de couverture
```

## Nouveaux endpoints API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/hub/batch-scan` | admin, agent_hub | Scanner jusqu'à 50 colis d'un coup |
| GET | `/api/hub/search` | admin, agent_hub | Recherche colis (?q=, ?status=, ?island=) |
| GET | `/api/hub/stats/week` | admin, agent_hub | Stats hub 7 derniers jours |

## Variables d'environnement nouvelles (optionnelles)

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_POOL_MAX` | 20 | Nombre max de connexions pool |
| `DB_STATEMENT_TIMEOUT` | 30000 | Timeout query en ms |

## Notes

- Le CI pipeline se déclenche automatiquement sur PR et push to main
- Le request-id est renvoyé dans les réponses d'erreur pour faciliter le debug
- Le password reset exige maintenant current_password pour les self-changes
- Le pool DB logge son état toutes les 5 minutes (sauf en test)
