# LOT 0 — Cartographie & harnais

Lot **fondateur** de la refonte Admin/Dashboards. **Aucune modification métier.**
Réf. doctrine : `docs/doctrine/DOCTRINE_ADMIN_DASHBOARDS.md` (Partie IV, LOT 0).

> **STOP avant LOT 2** : aucun chantier UI ne démarre tant que le gate de sortie ci-dessous n'est pas vert.

## Sous-lots et statut

| Sous-lot | Livrable | Emplacement | Statut |
|---|---|---|---|
| **0A** | Matrice détaillée des 30 surfaces (question, APIs, actions, données, rôles, destination, verdict KEEP/MERGE/REBUILD/DELETE) | `docs/LOT_0A_SURFACES_LIVRABLE.md` | ⬜ à produire (base : doctrine Partie III) |
| **0B** | Inventaire des variables (type, source, `CONSUMED_BY`, `DISPLAY_IN`, `EDIT_IN`, owner, verdict) | `docs/LOT_0B_VARIABLES_LIVRABLE.md` | ⬜ à produire |
| **0C-eco** | Golden CDR CURRENT (filet de parité) | `tools/golden-cdr/` | ✅ livré (harnais + démo) — reste à `capture` sur la DB de référence |
| **0C-ui** | Contrats figés des surfaces conservées (formes de réponse) | `docs/contract/DASHBOARDS_CONTRACTS_0C.md` | ⬜ à produire |
| **0D** | Doctrine coûts OWNED/DEDICATED/DERIVED | doctrine I-5 + `docs/adr/ADR-013-fret-transport-rails-wm.md` | ✅ figée (dont fret DEDICATED W/M, option b) |

## Gate de sortie du LOT 0

Le lot est clos quand **les cinq** sont vrais :

1. `0A` — chaque surface a une destination cible et un verdict.
2. `0B` — chaque variable a un `CONSUMED_BY` prouvé (aucun éditeur de table morte non signalé).
3. `0C-eco` — `golden/cdr.golden.json` capturé sur la branche de référence, `verify` vert en CI.
4. `0C-ui` — contrats figés pour au moins les surfaces KEEP/MERGE des dashboards Pilotage & Finance.
5. `0D` — doctrine coûts figée (✅).

## Golden CDR — commandes

```bash
# Capture (une fois, sur la branche de référence, DB accessible) :
node tools/golden-cdr/golden-cdr.js capture      # → tools/golden-cdr/golden/cdr.golden.json

# Vérification (CI + local) :
node tools/golden-cdr/golden-cdr.js verify        # exit 0 = parité OK, exit 1 = rompue

# Démo hors-DB :
node tools/golden-cdr/_demo-run.js capture --demo && node tools/golden-cdr/_demo-run.js verify --demo
```

Le gate CI est armé une fois `golden/cdr.golden.json` (réel) capturé et commité — voir
`.github/workflows/golden-cdr.yml`.

## Décisions résiduelles (non bloquantes — se tranchent dans ce lot)

- **0A** : verdict `ProblemsView` (absorption pure vs correction de vérité — diverge-t-il de `signals` ?).
- **0C-ui** : ordre de gel des 59 contrats (prioriser Pilotage/Finance).
- **Ops WS** : inventaire fonctionnel de `HubRelaisView` avant fusion.
