# Komerce — Backend API e-commerce diaspora comorienne

API backend (Node.js / Express / PostgreSQL) de la plateforme e-commerce
Komerce. Ce dépôt fait partie d'un monorepo à trois volets : ce backend,
le frontend boutique et le frontend dashboards admin.

## Prérequis

- Node.js >= 20
- PostgreSQL (schéma de référence : `docs/db/railway-live-schema.sql`, dump
  de production Railway)

## Démarrage

```bash
npm install
cp .env.example .env   # renseigner DATABASE_URL et les autres variables
npm run dev             # serveur en local (nodemon)
npm start                # build + démarrage (production)
```

## Tests

```bash
npm test                 # jest --runInBand --forceExit --detectOpenHandles
```

`pretest` exécute automatiquement `backend:audit` (gouvernance) avant la suite.

## Gouvernance

Ce backend suit une architecture **feature-first** : chaque fichier touché doit
appartenir à une feature déclarée (manifeste `*.feature.js`) ou à un périmètre
transversal explicite. Les gates de gouvernance (`arch:check`, `arch:gate`,
`backend:audit`, `feature:registry`, etc. — voir `package.json`) sont exécutés
en CI (`.github/workflows/ci.yml`, `governance.yml`, `carte-first.yml`) et
doivent passer avant merge.

Documentation de référence :

- `AGENTS.md` — conventions pour les agents/contributeurs
- `docs/doctrine/FEATURE_SLICE_DOCTRINE.md` — doctrine feature-slice
- `docs/CONTRACTS.md` — contrats d'API
- `docs/ZONE_IMPACT.md` — zones d'impact par domaine
- `docs/chantier/STATUS.md` — état opérationnel du chantier (journal de sessions,
  source de vérité à jour — préférer ce fichier à tout résumé plus ancien)

## Structure

```
routes/       endpoints Express
services/     logique métier
migrations/   migrations SQL (source de vérité : dump Railway live)
features/     manifestes feature-slice (*.feature.js)
scripts/      gates de gouvernance, génération de docs, outillage CI
tests/        unit / integration / contract
docs/         doctrine, cartographie, contrats, journal de chantier
```

## Base de données

La source de vérité du schéma est `docs/db/railway-live-schema.sql` (dump de
production), pas un `db/schema.sql` maintenu à la main. Le pipeline CI
(`ci-migrate.js`) calcule une baseline dynamique par comparaison git.

<!-- Controlled PR-enforcement proof: README-only changes must keep scoped domain jobs skipped. -->
