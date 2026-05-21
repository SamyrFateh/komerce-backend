# H1D — Codemod crons opérationnels

> Date : 2026-05-21  
> Module : `bootstrap/crons.js`  
> Codemod : `scripts/h1d-wire-crons.js`

---

## Objectif

Préparer l'extraction des crons opérationnels hors de `server.js`, sans toucher aux webhooks Stripe raw, aux routes API/HTML, à `express.json`, aux migrations inline ni au listen/shutdown.

Cette PR prépare H1D mais ne câble pas encore `server.js`.

---

## Commandes locales

```bash
node scripts/h1d-wire-crons.js --check
node scripts/h1d-wire-crons.js --write
git diff -- server.js
npm test
npm run test:p0
```

---

## Scope du module

`bootstrap/crons.js` contient :

- `startOperationalCrons()`
- `startCashRelaisCron(...)`
- `startBackorderCron(...)`

---

## Garde-fous

Le codemod vérifie que restent présents dans `server.js` :

- webhooks Stripe raw avant `express.json` ;
- `express.json` ;
- montages API H1A ;
- `/api/health` ;
- `errorHandler` ;
- `app.listen` ;
- initialisations wallet/routing/security.

---

## Statut

```text
H1D-0 = module + codemod prêts
H1D-1 = câblage server.js à appliquer localement puis tester
```
