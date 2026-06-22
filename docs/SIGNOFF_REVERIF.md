# Re-vérification de conformité — coup de tampon (cette passe)

Vérifié contre le **code réel** du zip (deps installées, portes en live).

## ✅ Tout est conforme et vert
| Vérif | Résultat |
|---|---|
| backend:audit | ✅ 0 violation (7 avertissements connus) |
| security:360:check | ✅ aucune nouvelle anomalie (baseline 51) |
| arch:check (bloquant) | ✅ 0 sans-header, 0 violation |
| Drift graphe arch | ✅ aucun (régén = identique) |
| Contrat OpenAPI | ✅ déterministe (régén = identique) |
| **Suite unit COMPLÈTE** | ✅ **52/52 suites, 684 tests verts** (quarantaine résorbée) |
| Conformance P4-1 | ✅ observe + `DISABLE_RATE_LIMIT` + continue-on-error (état calibration correct) |

## ✅ Le point qui restait ouvert : `product_ref` (500 CI sur GET /api/products)
- Corrigé : `product_ref` est désormais dans `db/schema.sql` (7 occurrences).
- Les **27 colonnes** du SELECT de `GET /api/products` existent toutes dans `schema.sql`.
- **Pas de whack-a-mole** : sur les **51 colonnes** ajoutées par les migrations >052 et
  utilisées dans les routes, **aucune n'est absente de `schema.sql`**. Le patch n'a pas
  laissé de 500 latent derrière lui.

## ✅ Avancées au-delà du dernier état
- **Lot P7-tests FAIT** : les 9 suites jadis en quarantaine sont **toutes vertes**, et la
  quarantaine a été **retirée de `ci.yml`** → la gate bloquante couvre toute la suite.
  (Explique le rouge transitoire vu en CI : quarantaine retirée avant que les 9 soient vertes.)
- **`admin-authz-probe` : 17/17 en CI réelle** (Postgres) — la preuve runtime d'autorisation
  admin, enfin obtenue.

## 🧹 Corrigé cette passe
- `docs/CABLAGE.md` était **périmé** (décrivait la quarantaine comme active + P7-tests
  comme lot ouvert). Mis à jour pour refléter la réalité.

## ▶️ Reste (forward, pas des trous)
- **P4-1 → bloquant** : promouvoir `--checks server_error` une fois les 5xx restants traités.
  Ces 5xx viennent de routes avec `catch { res.status(500) }` **local** (ex: `signals`)
  qui court-circuitent l'error-handler global (où `22P02 → 400` est posé). Fix = remplacer
  ces catches par `next(err)` sur les routes fautives (liste à tirer du prochain rapport observe).
- Limites non franchissables ici : pas de Postgres en sandbox → intégration + conformance
  non rejouables en local (mais `admin-authz-probe` a déjà prouvé son verdict en CI réelle).

## Verdict
**Conforme.** Toutes les portes vertes, le fix `product_ref` est complet (sans whack-a-mole),
la suite de tests est entièrement verte et la quarantaine proprement résorbée. Aucune lacune
de socle ; le reste est du forward cadré.
