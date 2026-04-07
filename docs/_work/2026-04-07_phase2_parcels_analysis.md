# 🔄 Phase 2 — Double Écriture Parcels : Analyse d'Impact

**Date** : 2026-04-07
**Auteur** : Agent Tasklet
**Statut** : ✅ Analyse terminée → prêt à coder

---

## 1. Objectif

Quand un scan est enregistré, écrire dans `parcels` EN PLUS du flux legacy.
- Le trigger `trg_scan_sync_status` continue de mettre à jour `orders.status` (legacy)
- En parallèle, on met à jour `parcels.status` + `orders.computed_status` (nouveau)
- **Zéro régression** : le legacy fonctionne exactement comme avant

---

## 2. Fichiers impactés

| Fichier | Impact | Description |
|---------|--------|-------------|
| `utils/parcelSync.js` | **NOUVEAU** | Module `syncScanToParcels()` — logique double écriture |
| `routes/scans.js` | **MODIFIÉ** | Appel `syncScanToParcels()` après chaque INSERT scan |
| `db/migrations/011_parcels_dual_write.sql` | **NOUVEAU** | Trigger DB ou fonction helper (optionnel) |

---

## 3. Flux actuel (legacy)

```
POST /api/scans
  → Résoudre scan_code → order_id
  → INSERT INTO scans (...)
  → Trigger trg_scan_sync_status → UPDATE orders.status
  → SMS selon step
  → Response
```

Endpoints impactés :
- `POST /api/scans` (scan générique)
- `POST /api/scans/collect` (retrait par pickup_code)
- `POST /api/scans/verify-qr` (retrait par QR token)
- `triggerScan3()` (auto-déclenché par purchasing.js)

---

## 4. Flux Phase 2 (double écriture)

```
POST /api/scans
  → Résoudre scan_code → order_id
  → INSERT INTO scans (...) → RETURNING id
  → Trigger trg_scan_sync_status → UPDATE orders.status  [LEGACY — inchangé]
  → syncScanToParcels(order_id, step, scan_id)            [NOUVEAU]
      ├─ Trouver les parcels actifs de l'order
      ├─ Pour chaque parcel : UPDATE status + timestamp
      ├─ UPDATE scans SET parcel_id = ... WHERE id = scan_id
      ├─ Recompute orders.computed_status via computeOrderStatus()
      └─ (non bloquant — erreur loggée, pas de 500)
  → SMS selon step
  → Response
```

---

## 5. Logique de `syncScanToParcels()`

### 5.1 Mapping step → parcel_status

| Scan step | Parcel status | Timestamp column |
|-----------|--------------|------------------|
| `preparation` | `preparation` | `prepared_at` |
| `shipped` | `shipped` | `shipped_at` |
| `in_transit` | `in_transit` | `in_transit_at` |
| `relais_received` | `available` | `available_at` |
| `collected` | `collected` | `collected_at` |

### 5.2 Résolution du parcel

**Cas 1 : scan sur une commande entière** (scan_code = KOM-2026-XXXX)
- Tous les parcels actifs (status ≠ cancelled) de l'order avancent au même step
- Cas typique pour shipped, in_transit, relais_received (tout le lot voyage ensemble)

**Cas 2 : scan sur un article** (scan_code = KOM-ITEM-XXXX)
- Résoudre order_item_id → parcel_items.parcel_id
- Seul CE parcel avance
- Les autres parcels restent à leur statut actuel

**Cas 3 : pas de parcel trouvé**
- Log warning, ne rien faire (commandes legacy sans parcels)
- Le legacy continue de fonctionner normalement

### 5.3 Garde : pas de retour en arrière

- Un parcel ne peut QUE avancer dans le pipeline (draft → preparation → shipped → ...)
- Si le nouveau statut a un poids ≤ au statut actuel → ignorer silencieusement
- Utilise STATUS_WEIGHT de utils/parcels.js

### 5.4 Recompute computed_status

- Après mise à jour des parcels, lire tous les parcels de l'order
- Appeler `computeOrderStatus(parcels)` (fonction pure de Phase 1)
- UPDATE `orders.computed_status = résultat`
- Pendant la transition, `orders.status` (legacy) et `orders.computed_status` coexistent

---

## 6. Décisions architecturales

1. **Non bloquant** : `syncScanToParcels()` est wrappé dans try/catch. Si ça échoue, le scan legacy est déjà enregistré → aucune régression.

2. **Pas de transaction partagée** : Le scan INSERT + trigger legacy est dans sa propre transaction. Le sync parcels est séparé pour éviter tout deadlock.

3. **Idempotent** : Appeler syncScanToParcels() 2 fois avec le même step ne fait rien (garde poids ≤).

4. **Extensible** : Quand un scan concerne un article spécifique, on pourra granulariser au niveau parcel. Pour l'instant, la majorité des scans sont au niveau commande.

---

## 7. Plan d'implémentation

1. ✅ Analyse (ce fichier)
2. ⬜ Migration `011_parcels_dual_write.sql` — index supplémentaires si nécessaire
3. ⬜ `utils/parcelSync.js` — module syncScanToParcels()
4. ⬜ `routes/scans.js` — intégrer l'appel dans les 4 endpoints
5. ⬜ Log dans `docs/_logs/` + mise à jour REPRISE_SESSION
