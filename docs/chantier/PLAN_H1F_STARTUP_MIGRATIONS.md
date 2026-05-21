# H1F — Extraction des migrations inline de `server.js`

## Objectif

Extraire le bloc de migrations/seeds exécuté au démarrage de `server.js` vers un bootstrap dédié, sans modifier le comportement runtime.

Cible finale :

```js
const { runStartupMigrations } = require('./bootstrap/startup-migrations');

const server = app.listen(PORT, () => {
  console.log(`KOMERCE API v12.4 — port ${PORT} — démarrage immédiat — migrations en background`);

  setImmediate(() => {
    runStartupMigrations({ db, fixAdminHash, fixMissingSchema, runAllSeeds })
      .catch(err => console.error('❌ Migration error (non-fatal, serveur opérationnel):', err.message));
  });
});
```

## Pourquoi H1F est sensible

Contrairement à H1A/H1B/H1C/H1D/H1E, ce bloc contient des opérations DB réelles :

- `fixAdminHash()`
- `fixMissingSchema()`
- `runAllSeeds()`
- migrations SQL inline historiques
- migrations scriptées `migration-037`, `migration-038`, `migration-039`
- création/seed utilisateur transitaire
- création de tables opérationnelles et économiques
- contraintes, index, colonnes et enums

Une erreur de découpe peut faire démarrer Railway tout en empêchant une migration de s'exécuter. H1F doit donc être fait en deux temps : préparation puis câblage local contrôlé.

## Bornes du bloc à extraire

### Début

Dans `server.js`, le bloc commence après :

```js
const server = app.listen(PORT, () => {
  console.log(`KOMERCE API v12.4 — port ${PORT} — démarrage immédiat — migrations en background`);

  setImmediate(async () => {
    try {
      await fixAdminHash();
      await fixMissingSchema();
      await runAllSeeds();
```

### Fin

Le bloc se termine juste avant :

```js
  });
});

process.on('SIGTERM', () => {
```

La dernière instruction métier interne attendue est :

```js
console.log('✅ Migrations et seeds terminées');
```

suivie de :

```js
    } catch (err) {
      console.error('❌ Migration error (non-fatal, serveur opérationnel):', err.message);
    }
  });
});
```

## Fichier cible

Créer :

```text
bootstrap/startup-migrations.js
```

Exporter :

```js
async function runStartupMigrations({ db, fixAdminHash, fixMissingSchema, runAllSeeds }) {
  // contenu actuel du try interne, sans setImmediate et sans app.listen
}

module.exports = { runStartupMigrations };
```

## Contraintes non négociables

- Ne pas modifier les requêtes SQL.
- Ne pas renommer les migrations historiques.
- Ne pas changer l'ordre d'exécution.
- Ne pas transformer les erreurs non fatales en erreurs fatales.
- Conserver les messages `console.log` / `console.warn` existants pour traçabilité Railway.
- Garder le `catch` global non fatal autour du bootstrap.
- Ne pas déplacer `app.listen`, `SIGTERM`, crash guards ou `module.exports = app`.

## Codemod recommandé

Créer :

```text
scripts/h1f-wire-startup-migrations.js
```

Le codemod doit :

1. Ajouter l'import :

```js
const { runStartupMigrations } = require('./bootstrap/startup-migrations');
```

2. Remplacer uniquement le contenu `setImmediate(async () => { ... })` par :

```js
  setImmediate(() => {
    runStartupMigrations({ db, fixAdminHash, fixMissingSchema, runAllSeeds })
      .catch(err => console.error('❌ Migration error (non-fatal, serveur opérationnel):', err.message));
  });
```

3. Refuser le câblage si l'un des marqueurs suivants manque :

- `await fixAdminHash();`
- `await fixMissingSchema();`
- `await runAllSeeds();`
- `console.log('✅ Migrations et seeds terminées');`
- `process.on('SIGTERM'`
- `module.exports = app;`

## Validation attendue

Avant commit :

```powershell
node scripts/h1f-wire-startup-migrations.js --check
node scripts/h1f-wire-startup-migrations.js --write
git diff -- server.js bootstrap/startup-migrations.js scripts/h1f-wire-startup-migrations.js
npm test
$env:P0_BASE_URL="https://komerce-backend-production.up.railway.app"
npm run test:p0
```

Après merge/déploiement Railway :

```powershell
npm run test:p0
railway logs
```

Dans les logs Railway, vérifier que le démarrage affiche encore :

```text
KOMERCE API v12.4 — port ... — démarrage immédiat — migrations en background
✅ Migrations et seeds terminées
```

## Décision

H1F-PREP peut être mergé seul car il ne change pas le runtime.

Le câblage H1F effectif doit être une PR séparée avec diff local relu.
