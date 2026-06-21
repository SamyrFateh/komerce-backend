# Câblage des portes — qui tourne où (une bonne fois)

| Porte | pre-commit (local, rapide) | CI (PR + push) | Boote l'app ? |
|---|:--:|:--:|:--:|
| arch headers / hygiène / drift / SQL / doctrine | ✅ | ✅ governance.yml | non (statique) |
| **backend:audit** (invariants I-BACK-*) | ✅ **(nouveau)** | ✅ **ci.yml/unit (nouveau)** | non (statique) |
| boutique / dashboards / meta 360 | ✅ | ✅ (carto-guard / governance) | non (statique) |
| contrat OpenAPI — drift `git diff` | — | ✅ contract.yml | oui (introspection) |
| security:360:check | — | ✅ contract.yml | oui (introspection) |
| tests unit (suites saines) | — | ✅ ci.yml/unit (bloquant) | non |
| tests unit (9 quarantaine) | — | ⚠️ ci.yml/unit (visible, non-bloquant) | non |
| **admin-authz-probe** + security-grid + intégration | — | ✅ ci.yml/integration (Postgres + env complet) | oui |

## Ce qui a été câblé cette passe
1. **backend:audit** : était branché NULLE PART → désormais pre-commit (local) **et**
   CI (bloquant). C'est la porte qui vérifie SQL paramétré, owner unique payment_status,
   auth admin.
2. **Job unit rendu vert et utile** : il était rouge en permanence (18 échecs) donc
   ignoré de fait. Maintenant : gate verte bloquante sur 43 suites saines + 9 suites
   en quarantaine visible non-bloquante (cf. KNOWN_FAILING_TESTS.md).
3. **Fuite isweep** neutralisée (intégration exclue du job unit).
4. **Angle mort Security 360** (multi-export `/api/admin/shared-carts`) corrigé →
   contrat 154 = Security 360 154.

## Restent (non câblage — contenu)
- Lot **P7-tests** : résorber les 9 suites quarantaine (mock périmé vs vrai bug).
- **P4-1** : conformité de contrat boîte-noire (Schemathesis/Dredd) — la seule porte
  d'audit empirique pas encore posée.
- `admin-authz-probe` : jamais exécutée hors CI (pas de Postgres en local) — son
  premier run CI réel est la preuve à surveiller.
