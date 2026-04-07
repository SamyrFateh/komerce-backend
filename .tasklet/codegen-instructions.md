# Komerce Code Generator

Generates all code files for Komerce backend Vague 1, 2, 3 compliance work.

## Instructions

You are a Node.js/Express backend developer working on the Komerce e-commerce platform.
Your job is to generate/modify all code files needed for Vague 1, 2, 3 compliance.

The existing files are downloaded at `/agent/home/komerce-work/`.
You MUST save all output files to `/agent/home/komerce-output/` organized by commit:
- `/agent/home/komerce-output/c1-security/` — Security fixes
- `/agent/home/komerce-output/c2-logistics-r1/` — Logistics R1 fix
- `/agent/home/komerce-output/c3-parcels-api/` — Parcels CRUD API
- `/agent/home/komerce-output/c4-hub/` — Hub terrain
- `/agent/home/komerce-output/c5-v3-optim/` — V3 optimisation

### Tech Stack Context
- Node.js + Express + PostgreSQL
- JWT auth via middleware/auth.js (authenticate, requireRole)
- Validation via middleware/validate.js + validators/index.js (Joi)
- Parcel sync engine: utils/parcelSync.js (safeSyncScanToParcels)
- Parcel utils: utils/parcels.js (PARCEL_TYPES, PARCEL_STATUSES, STATUS_WEIGHT, computeOrderStatus, splitOrderIntoParcels)
- Reference generator: utils/reference.js (generateParcelRef, generateShipmentRef)
- SMS: utils/sms.js (sendSMS)
- Rate limiting: middleware/rate-limit.js

### Key Rules
- **R1**: No flow depends on order completeness. Each parcel is autonomous. orders.status = aggregation via parcelSync, never written directly.
- **R2**: Hub operator: scan → box → seal. Only 3 actions exposed.

---

## ✅ COMPLETED — Vague 1 (C1–C3-bis)

All merged to main. See PR history.

## ✅ COMPLETED — Vague 2+3 (C4–C8)

Merged via PR #119:
- C4: routes/hub.js
- C5: server.js câblage /api/hub + /api/carriers
- C6: migrations/015_customs_enrichment.sql
- C7: migrations/016_carriers.sql
- C8: routes/carriers.js

## ✅ COMPLETED — Hotfix SyntaxError L619

Merged via PR #120: Fix string escape in Samsung seed data.

---

## ⬜ TODO — Hub Safety Fixes (A/B/C)

### Migration: `017_hub_safety_constraints.sql`

```sql
-- 017 — Hub Safety Constraints (A + C)

-- A: Un order_item ne peut être que dans UN seul parcel
ALTER TABLE parcel_items
  ADD CONSTRAINT unique_order_item_per_parcel UNIQUE (order_item_id);

-- C: Un seul colis draft par commande
CREATE UNIQUE INDEX IF NOT EXISTS one_draft_per_order
  ON parcels (order_id)
  WHERE status = 'draft';
```

### Fix A+C: `routes/parcels.js`

Dans `POST /:id/items` (ajout item au colis) :
- Wrap l'INSERT dans try/catch
- Catch erreur code `23505` (unique_violation) → 409 "Cet article est déjà assigné à un colis"

Dans `POST /` (création colis) :
- Wrap l'INSERT dans try/catch
- Catch erreur code `23505` → 409 "Un colis draft existe déjà pour cette commande"

### Fix B: `routes/hub.js`

Dans les 3 endpoints (scan/pack/seal) :
1. `const client = await db.getClient()`
2. `BEGIN`
3. `SELECT ... FROM parcels WHERE ... FOR UPDATE` (verrouille la ligne)
4. Vérifier le statut attendu
5. `COMMIT`
6. Appeler `safeSyncScanToParcels` après le commit
7. `finally { client.release() }`

Le fichier hub.js complet avec FOR UPDATE est déjà préparé dans `/agent/home/komerce-output/routes/hub.js`.

### PR Branch: `fix/hub-safety-abc`

Fichiers à inclure dans la PR :
1. `migrations/017_hub_safety_constraints.sql` (nouveau)
2. `routes/hub.js` (modifié — FOR UPDATE)
3. `routes/parcels.js` (modifié — catch 23505)

---

## ⬜ TODO — C9: Dashboard logistics costs

Pas encore spécifié. À définir avec le client.

---

### CRITICAL RULES FOR CODE GENERATION:
1. Read each source file from GitHub using the GitHub tools (ref: main)
2. For modified files: make ONLY the specified changes, keep everything else identical
3. Save output files under `/agent/home/komerce-output/`
4. Use the same coding style as existing code (const, arrow functions where appropriate, async/await, template literals)
5. All DB queries MUST use parameterized queries ($1, $2, etc.) — NEVER string concatenation
6. Use `try/catch` with proper error logging and 500 responses
7. Always import what you need at the top of the file
