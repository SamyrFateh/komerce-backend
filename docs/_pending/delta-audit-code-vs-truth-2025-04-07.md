# Delta — Audit Code vs Truth

| Champ | Valeur |
|-------|--------|
| Date | 2025-04-07 |
| Type | Analyse / Audit |
| Sévérité | 🔴 CRITIQUE |
| Statut | ⏳ EN ATTENTE — corrections à appliquer prochaine session |

## Résumé

Audit systématique du code réel vs Cartographie 360 v15.12.
**Drift majeur détecté** : refonte Parcel-Centric complète non documentée.

## Corrections à appliquer (14 actions)

### Carto — Schéma DB
- [ ] Ajouter tables `parcels`, `parcel_items`
- [ ] Retirer tables `sub_orders`, `sub_order_items`
- [ ] Ajouter enum `parcel_status`
- [ ] Corriger triggers (retirer trg_scan_sync_status, ajouter trg_parcels_updated)
- [ ] Corriger fonctions (retirer sync_order_status_from_scan)

### Carto — Routes & Fichiers
- [ ] Ajouter section config.js (5 endpoints)
- [ ] Ajouter `utils/parcels.js` et `utils/parcelSync.js` dans l'arbre
- [ ] Ajouter `public/Komerce_Config.html`
- [ ] Retirer `AGENT_RULES.md` et `docs/AGENTS_PROTOCOL.md` fantômes
- [ ] Ajouter migrations 010-013 dans l'arbre

### Carto — Métriques & Dépendances
- [ ] Mettre à jour tous les SHA divergents (6 fichiers)
- [ ] Mettre à jour les métriques globales (utils, migrations, endpoints, enums)
- [ ] Corriger Section 7 dépendances inter-routes (scans → parcelSync)
- [ ] Ajouter docs gouvernance dans Section 15

### Investigation complémentaire
- [ ] Lire `routes/dashboard.js` (+10 KB) — identifier nouveaux endpoints
- [ ] Vérifier `scans.js` — confirmer intégration parcelSync uniquement

## Fichier source

→ `docs/_work/AUDIT_CODE_VS_TRUTH_2025-04-07.md`

## Gouvernance

- ✅ Delta déposé
- ✅ Carto impactée (corrections à venir)
- ✅ Roadmap vérifiée (cohérente avec code)
