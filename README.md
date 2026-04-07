# 🛒 Komerce Backend

> E-commerce multi-vendeurs — Comores · Node.js / Express / PostgreSQL (Supabase)

---

## 🤖 PROTOCOLE AGENT — ORDRE STRICT

### 1. Lis la gouvernance
→ [`docs/GOVERNANCE.md`](./docs/GOVERNANCE.md) — **obligatoire avant toute action.**

### 2. Lis la toile d'impact
→ [`docs/ZONE_IMPACT.md`](./docs/ZONE_IMPACT.md) — **obligatoire avant tout code.**

Contient :
- 6 invariants absolus (R1–R6)
- 2 machines à états (orders + parcels) avec transitions interdites
- Matrice 24 composants × tables × dépendances × scores de risque
- Blast radius par zone
- Checklist pré-code à compléter
- Protocole de rollback

### 3. Identifie ta priorité
→ [`docs/ROADMAP_KOMERCE.md`](./docs/ROADMAP_KOMERCE.md)

```
📊 STATUT
✅ Dashboard 11/11 · Gouvernance 5/5 · Parcel-Centric 3/5
🟡 Vague 1 Logistique (~22h)
⬜ Vague 2 Hub Terrain · Vague 3 Optimisation · Catalogue Auto/Moto
🔴 Violations V-01 à V-04 · Issues #71–#76
```

### 4. Complète la checklist ZONE_IMPACT avant d'écrire une ligne

| # | Question | Réponse exigée |
|---|----------|----------------|
| 1 | Quelles zones je touche ? | Fichiers + scores de risque |
| 2 | Quelles tables j'écris ? | Liste INSERT/UPDATE/DELETE |
| 3 | Quel invariant pourrait casser ? | R1–R6 concernés |
| 4 | Quel est le blast radius ? | Modules impactés en cascade |
| 5 | Mon analyse est dans `_work/` ? | Chemin du fichier |
| 6 | Le propriétaire a validé ? | Oui / Non |

> ⚠️ **Si la réponse 6 est Non → STOP. Ne pas coder.**

---

## ⚡ Règles non-négociables

| # | Règle |
|---|-------|
| R1 | Jamais `UPDATE orders SET status` → passer par `parcelSync.js` |
| R2 | Hub = 3 actions seulement. Le système décide, l'opérateur exécute |
| R3 | `orders.status` = machine à états fermée. Aucun statut inventé |
| R4 | `parcels.status` = machine à états fermée. Idem |
| R5 | Stock = transaction Supabase. Jamais de write sans lock |
| R6 | Tout middleware sécurité existant reste en place |
| R7 | `assisted_request` → `order` uniquement sur action humaine explicite |
| 🔴 | Commit toutes les 10 min : `wip: [description]` |
| 🧠 | Commit immédiat des analyses dans `docs/_work/` avant de coder |
| 🚫 | Jamais "terminé" sans delta dans `docs/_pending/` |

---

## 📂 Documentation

| Doc | Quand le lire |
|-----|---------------|
| [`GOVERNANCE.md`](./docs/GOVERNANCE.md) | **Toujours — dès l'entrée** |
| [`ZONE_IMPACT.md`](./docs/ZONE_IMPACT.md) | **Avant tout code** |
| [`ROADMAP_KOMERCE.md`](./docs/ROADMAP_KOMERCE.md) | Priorités & état |
| [`CARTOGRAPHY_360.md`](./docs/CARTOGRAPHY_360.md) | Architecture complète — endpoints, tables, middlewares |
| [`PLAN_LOGISTIQUE_V2.md`](./docs/PLAN_LOGISTIQUE_V2.md) | Plan 3 vagues logistiques |
| [`AUDIT_REPORT.md`](./docs/AUDIT_REPORT.md) | Sécurité — issues #71–#84 |
| [`AGENT_CONFIG.md`](./docs/AGENT_CONFIG.md) | Bootstrap agent Tasklet |
| [`REPRISE_SESSION.md`](./docs/REPRISE_SESSION.md) | Reprise de session |
| [`GOVERNANCE_BOOTSTRAP.md`](./docs/GOVERNANCE_BOOTSTRAP.md) | Config gardien Tasklet |
| `docs/_work/` | Analyses en cours — **écrire ici avant de coder** |
| `docs/_pending/` | Deltas en attente d'intégration |

---

## 🚀 Quick Start (dev)

```bash
npm install
cp .env.example .env
npm start
```
