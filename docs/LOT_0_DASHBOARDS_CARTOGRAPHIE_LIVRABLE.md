# LOT 0 — Cartographie & harnais

Lot **fondateur** de la refonte Admin/Dashboards. **Aucune modification métier.**
Réf. doctrine : `docs/doctrine/DOCTRINE_ADMIN_DASHBOARDS.md` (Partie IV, LOT 0).

> **STOP avant LOT 2** : aucun chantier UI ne démarre tant que le gate de sortie ci-dessous n'est pas vert.

## Sous-lots et statut

| Sous-lot | Livrable | Emplacement | Statut |
|---|---|---|---|
| **0A** | Matrice détaillée des 30 surfaces (question, APIs, actions, données, rôles, destination, verdict KEEP/MERGE/REBUILD/DELETE) | `docs/LOT_0A_SURFACES_LIVRABLE.md` | ✅ livré |
| **0B** | Inventaire des variables (type, source, `CONSUMED_BY`, `DISPLAY_IN`, `EDIT_IN`, owner, verdict) | `docs/LOT_0B_VARIABLES_LIVRABLE.md` | ✅ livré |
| **0C-eco** | Golden CDR CURRENT (filet de parité) | `tools/golden-cdr/` | ⚠️ harnais + workflow CI livrés ; **golden CURRENT réel absent de `main` — capture DB requise** |
| **0C-ui** | Contrats figés des surfaces conservées (formes de réponse) | `docs/contract/DASHBOARDS_CONTRACTS_0C.md` | ⬜ à produire |
| **0D** | Doctrine coûts OWNED/DEDICATED/DERIVED | doctrine I-5 + `docs/adr/ADR-013-fret-transport-rails-wm.md` | ✅ figée (dont fret DEDICATED W/M, option b) |

**État réel du gate : 3/5.** 0C-eco n'est clos qu'après présence de `tools/golden-cdr/golden/cdr.golden.json` capturé depuis la DB de référence et `verify` vert ; 0C-ui reste à produire.

## Gate de sortie du LOT 0

Le lot est clos quand **les cinq** sont vrais :

1. `0A` — chaque surface a une destination cible et un verdict. ✅
2. `0B` — chaque variable a un `CONSUMED_BY` prouvé (aucun éditeur de table morte non signalé). ✅
3. `0C-eco` — `golden/cdr.golden.json` capturé sur la branche de référence, `verify` vert en CI. ⬜
4. `0C-ui` — contrats figés pour au moins les surfaces KEEP/MERGE des dashboards Pilotage & Finance. ⬜
5. `0D` — doctrine coûts figée. ✅

## Golden CDR — commandes

```bash
# Capture (une fois, sur la branche de référence, DB accessible) :
node tools/golden-cdr/golden-cdr.js capture      # → tools/golden-cdr/golden/cdr.golden.json

# Vérification (CI + local) :
node tools/golden-cdr/golden-cdr.js verify        # exit 0 = parité OK, exit 1 = rompue

# Démo hors-DB :
node tools/golden-cdr/_demo-run.js capture --demo && node tools/golden-cdr/_demo-run.js verify --demo
```

Le gate CI est présent dans `.github/workflows/golden-cdr.yml` et exige explicitement le golden CURRENT réel.

## Ordre de reprise

1. Capturer puis commiter le Golden CDR CURRENT réel ; `verify` doit être vert → 0C-eco ✅.
2. Produire 0C-ui : contrats de réponse des surfaces KEEP/MERGE Pilotage & Finance, tests structurels, `UNKNOWN` explicite si non prouvé.
3. Une fois 0C-ui mergé : LOT 0 = 5/5, lever le STOP et ouvrir LOT 1A.

## Décisions résiduelles

- **ProblemsView** : absorption pure vs correction de vérité — diverge-t-il de `signals` ?
- **PricingView / PricingWorkshopView** : finir la passe manuelle des wrappers `fetch(path, opts)`.
- **Ops WS** : inventaire fonctionnel de `HubRelaisView` avant fusion.
