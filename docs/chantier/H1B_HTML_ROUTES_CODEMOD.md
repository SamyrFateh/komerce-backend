# H1B — Codemod routes HTML / SPA fallback

> Date : 2026-05-20  
> Manifest : `bootstrap/html-routes.js`  
> Codemod : `scripts/h1b-wire-html-routes.js`

---

## Objectif

Préparer l'extraction des routes HTML et du fallback SPA hors de `server.js`, sans toucher aux webhooks Stripe raw, aux routes API, aux crons, aux migrations inline ni au listen/shutdown.

Cette PR prépare H1B mais ne câble pas encore `server.js`.

---

## Commandes locales

```bash
node scripts/h1b-wire-html-routes.js --check
node scripts/h1b-wire-html-routes.js --write
git diff -- server.js
npm test
npm run test:p0
```

---

## Scope du manifest

`bootstrap/html-routes.js` contient les routes HTML publiques, les routes événement, les routes admin SPA, les redirections legacy et le fallback `*`.

---

## Garde-fous

Le codemod vérifie que restent présents dans `server.js` :

- webhooks Stripe raw avant `express.json` ;
- `express.json` ;
- montages API H1A ;
- handlers Stripe shared/collective ;
- `/api/health` ;
- `errorHandler` ;
- crons ;
- `app.listen`.

---

## Statut

```text
H1B-0 = manifest + codemod prêts
H1B-1 = câblage server.js à appliquer localement puis tester
```
