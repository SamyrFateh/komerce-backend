# H1C — Codemod security / CORS / Helmet

> Date : 2026-05-20  
> Module : `bootstrap/security.js`  
> Codemod : `scripts/h1c-wire-security.js`

---

## Objectif

Préparer l'extraction CORS + Helmet hors de `server.js`, sans toucher aux webhooks Stripe raw, aux routes API/HTML, aux crons, aux migrations inline ni au listen/shutdown.

Cette PR prépare H1C mais ne câble pas encore `server.js`.

---

## Commandes locales

```bash
node scripts/h1c-wire-security.js --check
node scripts/h1c-wire-security.js --write
git diff -- server.js
npm test
npm run test:p0
```

---

## Scope du module

`bootstrap/security.js` contient :

- `isAllowedOrigin(...)`
- `buildCorsOptions()`
- `buildHelmetOptions()`
- `applySecurity(app)`

---

## Garde-fous

Le codemod vérifie que restent présents dans `server.js` :

- webhooks Stripe raw avant `express.json` ;
- `express.json` ;
- montages API H1A ;
- `/api/health` ;
- `errorHandler` ;
- `app.listen`.

---

## Statut

```text
H1C-0 = module + codemod prêts
H1C-1 = câblage server.js à appliquer localement puis tester
```
