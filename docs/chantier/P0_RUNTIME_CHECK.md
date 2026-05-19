# P0 runtime check helper

> Date : 2026-05-19  
> Script : `scripts/p0-runtime-check.js`  
> Commande npm : `npm run test:p0`

---

## Objectif

Fournir une commande simple pour passer la validation P0 de `PARTIAL` à `PASS` ou `FAIL` depuis un environnement qui peut exécuter Node et appeler le backend Railway.

Ce script ne modifie pas les données métier sauf si un endpoint non dry-run est ajouté plus tard. Dans sa version actuelle, les endpoints admin appelés sont en `dry_run:true`.

---

## Utilisation minimale

Lancer seulement Jest :

```bash
npm run test:p0
```

Résultat attendu :

- `PASS` si Jest passe ;
- `PARTIAL` si les checks HTTP sont sautés faute de `P0_BASE_URL` ;
- `FAIL` si Jest échoue.

---

## Utilisation avec health checks Railway

```bash
P0_BASE_URL=https://komerce-backend-production.up.railway.app npm run test:p0
```

Le script teste :

```text
GET /health
GET /api/health
```

---

## Utilisation avec dry-runs admin

```bash
P0_BASE_URL=https://komerce-backend-production.up.railway.app \
P0_ADMIN_TOKEN=<JWT_ADMIN> \
npm run test:p0
```

Le script teste en dry-run :

```text
POST /api/admin/collective/repair-ready-to-capture
POST /api/admin/collective/repair-stock-reservations
```

Pour tester aussi le refund admin dry-run :

```bash
P0_BASE_URL=https://komerce-backend-production.up.railway.app \
P0_ADMIN_TOKEN=<JWT_ADMIN> \
P0_ORDER_ID=<ORDER_ID_CANCELLED_OU_TEST> \
npm run test:p0
```

---

## Codes de sortie

| Code | Verdict |
|------|---------|
| 0 | PASS |
| 1 | FAIL |
| 2 | PARTIAL |

---

## Interprétation

- `PASS` : tous les checks disponibles ont réussi.
- `PARTIAL` : aucun échec, mais certains checks ont été sautés faute de variables.
- `FAIL` : au moins un check a échoué ; corriger avant de lancer PRICE-1/A4/F1/H1.

---

## Limites

Ce helper ne remplace pas une vraie campagne E2E complète.

Il donne un premier verdict reproductible sur :

- Jest ;
- health endpoints ;
- dry-runs admin non destructifs.

Les flows destructifs ou impliquant Stripe réel doivent rester manuels/staging contrôlé.
