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

### What to generate

#### C1: Security Fixes (3 files to modify)

**1. middleware/rate-limit.js** — Add `adminLimiter`:
- Read from `/agent/home/komerce-work/middleware/rate-limit.js`
- Add a new `adminLimiter` (30 req/min, strict for destructive admin operations)
- Export it alongside existing limiters

**2. server.js** — Fix CORS + wire admin limiter:
- Read from `/agent/home/komerce-work/server.js`
- Replace `isAllowedOrigin` with strict whitelist: only localhost in dev, only FRONTEND_URL + explicit ALLOWED_ORIGINS env var in prod. Remove the broad `*.up.railway.app` regex.
- Add `app.use('/api/admin/', adminLimiter)` import and usage (add to the imports from rate-limit.js and add usage line near the other rate limiter usages)
- DO NOT change anything else in server.js

**3. routes/admin.js** — Gate reset in production:
- Read from `/agent/home/komerce-work/routes/admin.js`
- Add production guard at top of POST /reset handler: `if (process.env.NODE_ENV === 'production') return res.status(403).json({ error: 'POST /admin/reset désactivé en production. Contactez le DevOps.' });`
- DO NOT change anything else

#### C2: Fix logistics.js R1 violations (1 file)

**routes/logistics.js**:
- Read from `/agent/home/komerce-work/routes/logistics.js`
- In PATCH /shipments/:id, replace the direct `UPDATE orders SET status='available'` with parcelSync loop:
  - Import `safeSyncScanToParcels` from `../utils/parcelSync`
  - When arrived_at && customs_cleared_at: query all parcels for orders in that shipment, then loop through each parcel and call safeSyncScanToParcels with step 'relais_received'
  - Replace SMS batch (1 per order) with SMS per parcel (1 per available parcel)
- Keep all other endpoints unchanged

Here's the fix for the PATCH handler (the block inside `if (arrived_at && customs_cleared_at)`):

```javascript
// ── R1 COMPLIANCE: Use parcelSync instead of direct UPDATE ──
// 1. Get all parcels for orders in this shipment
const { rows: shipmentParcels } = await db.query(`
  SELECT p.id AS parcel_id, p.order_id, p.reference AS parcel_ref,
         o.reference AS order_ref, u.phone, u.full_name,
         r.name AS relais_name, r.address AS relais_addr
  FROM parcels p
  JOIN orders o ON o.id = p.order_id
  JOIN users u ON u.id = o.user_id
  LEFT JOIN relais r ON r.id = o.relais_id
  WHERE o.shipment_id = $1 AND p.status != 'cancelled'
`, [req.params.id]);

// 2. Update each parcel via parcelSync (R1 compliant)
for (const sp of shipmentParcels) {
  await safeSyncScanToParcels({
    order_id: sp.order_id,
    step: 'relais_received',
    scan_id: null,
    scanned_by: req.user.id,
    notes: `Arrivée conteneur ${rows[0].container_ref || req.params.id}`,
  });
}

// 3. SMS per parcel (R1: 1 SMS per available parcel, not per order)
const smsTargets = shipmentParcels.filter(sp => sp.phone);
Promise.all(
  smsTargets.map(sp => sendSMS(
    sp.phone,
    `Komerce · Colis ${sp.parcel_ref || sp.order_ref} disponible au ${sp.relais_name} (${sp.relais_addr}).`,
    'available', null
  ))
).catch(err => console.error('SMS parcel batch error:', err.message));
```

#### C3: Parcels CRUD API (3 new files + 1 modification)

**1. NEW: routes/parcels.js** — Full CRUD API:
```
GET    /api/parcels              — List parcels (filters: status, shipment_id, order_id, search) — admin, agent_hub
GET    /api/parcels/:ref         — Detail by reference (KOM-P-*) — admin, agent_hub, agent_relais
POST   /api/parcels              — Create parcel manually — admin, agent_hub
PATCH  /api/parcels/:id/status   — Change status via parcelSync — admin, agent_hub
POST   /api/parcels/:id/items    — Add items to parcel — admin, agent_hub
DELETE /api/parcels/:id/items/:item_id — Remove item — admin, agent_hub
```
- All status changes go through safeSyncScanToParcels (R1 compliance)
- Use Joi validation via validate middleware
- Use authenticate + requireRole middleware
- Import parcels validators from ../validators

**2. NEW: validators parcels + hub section** — Modify validators/index.js:
- Read from `/agent/home/komerce-work/validators/index.js`
- Add `parcels` schemas (list query, create body, updateStatus body, addItem body)
- Add `hub` schemas (scan body, pack body, seal body)
- Export both new schema objects

**3. NEW: migrations/014_parcels_final_cleanup.sql**:
```sql
-- Migration 014: Parcels final cleanup — remove legacy columns, add indexes
-- Add indexes for common parcel queries
CREATE INDEX IF NOT EXISTS idx_parcels_order_id ON parcels(order_id);
CREATE INDEX IF NOT EXISTS idx_parcels_status ON parcels(status);
CREATE INDEX IF NOT EXISTS idx_parcels_shipment_id ON parcels(shipment_id);
CREATE INDEX IF NOT EXISTS idx_parcels_reference ON parcels(reference);
CREATE INDEX IF NOT EXISTS idx_parcel_items_parcel_id ON parcel_items(parcel_id);
CREATE INDEX IF NOT EXISTS idx_parcel_items_order_item_id ON parcel_items(order_item_id);
-- Cleanup: remove legacy sub_orders references if they exist
DROP TABLE IF EXISTS sub_order_items CASCADE;
DROP TABLE IF EXISTS sub_orders CASCADE;
```

#### C4: Hub Terrain (1 new file)

**NEW: routes/hub.js** — Hub 3-action interface:
```
POST /api/hub/scan    — Scan a parcel QR code (agent_hub receives item)
POST /api/hub/pack    — Mark parcel as packed (agent_hub)
POST /api/hub/seal    — Seal parcel, ready to ship (agent_hub)
GET  /api/hub/pending — Parcels awaiting processing
GET  /api/hub/today   — Today's stats (scanned, packed, sealed counts)
```
- R2 compliance: only 3 actions for operator (scan, pack, seal)
- All status changes via parcelSync
- Auth: authenticate + requireRole(['admin', 'agent_hub'])

#### C5: V3 Optimisation (3 new files)

**1. NEW: migrations/015_customs_enrichment.sql**:
```sql
-- Migration 015: Customs enrichment on parcels
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS customs_value_kmf NUMERIC(12,2);
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS customs_weight_kg NUMERIC(8,3);
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS customs_hs_code VARCHAR(20);
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS customs_cleared_at TIMESTAMPTZ;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS customs_notes TEXT;
```

**2. NEW: migrations/016_carriers.sql**:
```sql
-- Migration 016: Carriers table
CREATE TABLE IF NOT EXISTS carriers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  type VARCHAR(50) DEFAULT 'maritime',
  contact_name VARCHAR(100),
  contact_phone VARCHAR(30),
  contact_email VARCHAR(100),
  avg_transit_days INTEGER,
  cost_per_kg_kmf NUMERIC(10,2),
  is_active BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_carriers_active ON carriers(is_active) WHERE is_active = TRUE;
```

**3. NEW: routes/carriers.js** — Carrier CRUD + customs:
```
GET    /api/carriers              — List active carriers
POST   /api/carriers              — Create carrier (admin)
PATCH  /api/carriers/:id          — Update carrier (admin)
DELETE /api/carriers/:id          — Soft-delete carrier (admin)
PATCH  /api/parcels/:id/customs   — Update customs info on parcel (admin)
```

### CRITICAL RULES FOR CODE GENERATION:
1. Read each source file from `/agent/home/komerce-work/` using read_file tool
2. For modified files: make ONLY the specified changes, keep everything else identical
3. Save output files preserving directory structure under `/agent/home/komerce-output/{commit}/`
4. Use the same coding style as existing code (const, arrow functions where appropriate, async/await, template literals)
5. All DB queries MUST use parameterized queries ($1, $2, etc.) — NEVER string concatenation
6. Use `try/catch` with proper error logging and 500 responses
7. Always import what you need at the top of the file

### Output Structure:
```
/agent/home/komerce-output/
├── c1-security/
│   ├── server.js                    (modified)
│   ├── middleware/rate-limit.js      (modified)
│   └── routes/admin.js              (modified)
├── c2-logistics-r1/
│   └── routes/logistics.js          (modified)
├── c3-parcels-api/
│   ├── routes/parcels.js            (new)
│   ├── validators/index.js          (modified)
│   └── migrations/014_parcels_final_cleanup.sql (new)
├── c4-hub/
│   └── routes/hub.js                (new)
└── c5-v3-optim/
    ├── migrations/015_customs_enrichment.sql (new)
    ├── migrations/016_carriers.sql           (new)
    └── routes/carriers.js                    (new)
```

Process each commit folder in order. After generating all files, report back with a summary of what was created.

IMPORTANT: For modified files, you MUST read the FULL original file first, then make targeted changes. Do NOT rewrite from scratch — you will lose important code.
