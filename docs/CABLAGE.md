# Câblage des portes — qui tourne où (une bonne fois)

| Porte | pre-commit (local, rapide) | CI (PR + push) | Boote l'app ? |
|---|:--:|:--:|:--:|
| arch headers / hygiène / drift / SQL / doctrine | ✅ | ✅ governance.yml | non (statique) |
| **backend:audit** (invariants I-BACK-*) | ✅ **(nouveau)** | ✅ **ci.yml/unit (nouveau)** | non (statique) |
| boutique / dashboards / meta 360 | ✅ | ✅ contract.yml | non (statique) |
| contrat OpenAPI — drift `git diff` | — | ✅ contract.yml | oui (introspection) |
| security:360:check | — | ✅ contract.yml | oui (introspection) |
| tests unit (TOUTE la suite, 52/52) | — | ✅ ci.yml/unit (bloquant, quarantaine résorbée) | non |
| **admin-authz-probe** + security-grid + intégration | — | ✅ ci.yml/integration (Postgres + env complet) | oui |

## Ce qui a été câblé cette passe
1. **backend:audit** : était branché NULLE PART → désormais pre-commit (local) **et**
   CI (bloquant). C'est la porte qui vérifie SQL paramétré, owner unique payment_status,
   auth admin.
2. **Job unit rendu vert et utile** : il était rouge en permanence (18 échecs) donc
   ignoré de fait. Étape 1 : gate verte sur les suites saines + 9 en quarantaine visible.
   **Depuis (lot P7-tests) : les 9 sont réparées et la quarantaine retirée → la gate
   bloquante couvre désormais TOUTE la suite (52/52).**
3. **Fuite isweep** neutralisée (intégration exclue du job unit).
4. **Angle mort Security 360** (multi-export `/api/admin/shared-carts`) corrigé →
   contrat 154 = Security 360 154.

## Restent (non câblage — contenu)
- ~~Lot **P7-tests**~~ ✅ **FAIT** : les 9 suites quarantaine sont vertes, quarantaine retirée.
- **P4-1** : conformité de contrat boîte-noire ✅ **posée** (`contract-conformance.yml`),
  actuellement en **observe** (rate-limit neutralisé). Reste à promouvoir en bloquant
  scopé `server_error` une fois les derniers 5xx routes-locales (`catch{500}`) traités.
- `admin-authz-probe` : ✅ a tourné en CI réelle (Postgres) — **17/17 passés**.
