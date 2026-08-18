# ADR-012 — Plan de migration `scans` → `scan_events`

**Date** : 2026-05-24  
**Statut** : Accepté — implémentation à planifier en sprint dédié  
**Décision** : Déprécier progressivement `scans` au profit de `scan_events` (append-only, audit-safe)

---

## Contexte

Deux tables de scan coexistent sans politique de migration documentée :

| Table | Écrivains actuels | Schema | Usage |
|---|---|---|---|
| `scans` | `routes/scans.js`, `routes/hub-dashboard.js`, `services/verify-qr-collection.js` | `scan_code TEXT NOT NULL`, `step`, `scanned_by` | Legacy — créé avant le scan-engine |
| `scan_events` | `services/scan-engine.js` | `event_type`, `parcel_id`, `scan_code`, `metadata JSONB` | Nouveau — source de vérité post-migration Phase 2 |

Les deux tables reçoivent des événements en double sur certains flows (ex : `POST /api/scans/verify-qr` écrit dans `order_status_history` via la machine ET dans `scans` via le route handler).

---

## Décision

Migration en 4 phases, sans coupure prod.

### Phase A — Dual-write transitoire (sprint S+1, ~1 semaine)

Pour chaque INSERT existant dans `scans`, ajouter un INSERT miroir dans `scan_events`. Les deux tables sont maintenues.

Fichiers touchés :
- `routes/scans.js` — `POST /api/scans` (scan manuel hub)
- `routes/hub-dashboard.js` — start-prep et auto-prepare (patch R7 a déjà ajouté le `scan_code`)
- `services/verify-qr-collection.js` — vérification QR remise relais

```js
// Pattern dual-write
await db.query(`INSERT INTO scans (order_id, step, scanned_by, notes, scan_code) VALUES ...`);
await db.query(`INSERT INTO scan_events (order_id, event_type, scanned_by, scan_code, metadata)
                VALUES ($1, $2, $3, $4, $5)`,
  [orderId, stepToEventType(step), scannedBy, scanCode, JSON.stringify({ notes, source: 'legacy' })]);
```

### Phase B — Lecteurs migrés vers `scan_events` (sprint S+2)

Migrer tous les SELECT qui lisent `scans` pour lire `scan_events` :
- `routes/admin-radar.js` — historique scans par commande
- `routes/hub-dashboard.js` — affichage timeline scan
- `routes/orders/detail.js` — détail commande client

### Phase C — Arrêt des écritures dans `scans` (sprint S+3)

Supprimer les INSERT dans `scans`. Garder la table en lecture seule (données historiques).

Vérification : `SELECT COUNT(*) FROM scans WHERE created_at > NOW() - INTERVAL '7 days'` doit retourner 0.

### Phase D — Archivage et suppression (sprint S+4 ou S+6)

```sql
-- Archiver les données historiques scans dans scan_events (backfill)
INSERT INTO scan_events (order_id, event_type, scanned_by, scan_code, created_at, metadata)
SELECT order_id, 'legacy_scan', scanned_by, scan_code, created_at,
       jsonb_build_object('step', step, 'notes', notes, 'source', 'migration_scans_legacy')
FROM scans
ON CONFLICT DO NOTHING;

-- Renommer en table archive avant de DROP
ALTER TABLE scans RENAME TO _scans_archived_2026;
-- DROP TABLE _scans_archived_2026; -- après validation en staging
```

---

## Mapping `step` → `event_type`

```js
function stepToEventType(step) {
  const map = {
    'preparation':  'hub_prep_start',
    'scan_3':       'hub_scan_3',
    'shipped':      'shipped',
    'available':    'available_relais',
    'collected':    'collected',
    'verify_qr':    'qr_verified',
  };
  return map[step] || `legacy_${step}`;
}
```

---

## Risques

| Risque | Mitigation |
|---|---|
| Double comptage pendant dual-write | Ajouter colonne `scan_events.source TEXT DEFAULT 'scan_engine'` — les legacy ont `source = 'legacy'` |
| Perte données historiques | Phase D archivage avant DROP obligatoire |
| `scan_code NOT NULL` sur `scans` | Déjà géré par R7 (codes synthétiques `HUB-*`) |

---

## Critère de sortie de Phase C

`SELECT COUNT(*) FROM scans WHERE created_at > NOW() - INTERVAL '24 hours' = 0` pendant 7 jours consécutifs en staging.
