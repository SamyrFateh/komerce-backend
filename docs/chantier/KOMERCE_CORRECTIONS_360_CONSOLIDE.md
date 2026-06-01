# KOMERCE — CORRECTIONS CONSOLIDÉES & VISION 360°
**Document unique de travail** · Version 1.0 · 2026-05-31
**Nature** : ordre de travail pour l'agent exécutant (Sonnet) **+** tracker vivant **+** vision d'ensemble.
**Périmètre** : Backend (L1–L9) ⨯ Frontend (L1–L8), consolidé et **vérifié sur le dépôt réel**.

---

## 0. Mode d'emploi (pour Sonnet)

- Ce document est **la seule source** des corrections. On ne corrige rien qui n'y figure pas ; on n'invente pas de chemin.
- Chaque tâche porte un **Statut** : `☐ À faire` · `◐ En cours` · `☑ Fait` · `⛔ Bloqué (décision)`.
- En traitant une tâche : (1) appliquer sur le **chemin exact** indiqué, (2) cocher le Statut, (3) ajouter une ligne au **Journal §8**.
- `✔` en colonne *Vérif* = défaut **confirmé par lecture du code réel** (pas seulement par l'audit). Sans `✔` = hérité des audits, à reconfirmer avant correction.
- **Règle d'or** : on ne corrige une couture back↔front que **par paire, dans la même PR** (voir §2). Une demi-correction est une non-correction.

---

## 1. Tableau de bord d'avancement *(à mettre à jour)*

| Bloc | Intitulé | Tâches | ☑ Faites |
|---|---|---|---|
| 0 | Désambiguïsation de la vérité (préalable) | 9 | 8 |
| 1 | Sécurité | 19 | 0 |
| 2 | Control Tower vivant (dashboard admin moderne) | 4 | 1 |
| 3 | Métier & parcours | 11 | 0 |
| 4 | Hygiène & dette | 6 | 0 |
| 5 | Décision structurante (humaine) | 1 | 1 |
| **Total** | | **50** | **10** |

---

## 2. Vision 360 — pourquoi ces blocs (les 6 familles transverses)

Le risque ne vit pas dans une couche, mais dans la **couture**. Six familles relient back et front ; chacune impose une correction **conjointe**.

| # | Famille | Back | Front | Effet composé |
|---|---|---|---|---|
| F1 | Rôle fantôme `founder`/`super_admin` | enum DB = 4 valeurs, guards `founder` toujours faux → 403 | fallback `founder` → agents voient tous les menus | « Menus fantômes » : UI sur-autorise, API refuse |
| F2 | Révocation = théâtre | `jwt.verify` inline + magic-link sans `jti` | guard sur mauvaise clé, `isConnected` périmé | Session révoquée vit ET l'UI ne le voit pas |
| F3 | Endpoints sans auth | notification/transit/rates publics | confirmés consommés par l'UI | PII réellement atteignable |
| F4 | Parcours retrait cassé ×3 | `cached.code` → 500 | cookie mort `kmrc_client` + timeline divergente | Client ne reçoit ni code ni suivi |
| F5 | Erreurs avalées | `log` non importé, fallback récursif | `.catch(()=>{})` / `return {}` | Observabilité aveugle des deux côtés |
| F6 | Sources de vérité divergentes | ancien nom `schema_railway.sql` retiré des sources de vérité ; source canonique attendue `db/schema.sql` | CT zombie supprimé ; carto chantier redirigée vers la carto canonique | On réduit le risque d'auditer/éditer une fiction |

> **Trouvaille méta (F6)** : l'audit L7 a porté sur `public/js/ct-*` (zombie non servi). Ces fichiers ont été supprimés. Le CT vivant à viser désormais est le dashboard admin moderne : `public/dashboards/admin/`, vue principale `public/dashboards/admin/js/views/ControlTowerView.js`.

---

## 3. BLOC 0 — Désambiguïsation de la vérité *(préalable à tout)*

> Tant que des copies divergentes coexistent, toute correction peut viser le mort. **À faire en premier.**

| ID | Action | Chemin (vérifié) | Vérif | Prio | Statut |
|---|---|---|---|---|---|
| Z1 | Supprimer le backend servi en statique (fuite SQL/auth) | `public/js/dashboard.js` (2529 l.) | ✔ | 🔴 | ☑ |
| Z2 | Supprimer le middleware orphelin (0 require) | `middleware/auth-middleware.js` | ✔ | 🟡 | ☑ |
| Z3 | Supprimer le CT zombie (non servi, blanchi par re-audit) | `public/js/ct-*.js` (30 fichiers) | ✔ | 🟡 | ☑ |
| Z4 | Geler le dashboard admin moderne comme **owner CT** (doc) | `public/dashboards/admin/` + `ControlTowerView.js` | ✔ | 🟡 | ☑ |
| Z5 | Committer un schéma unique depuis la prod ; supprimer les refs à l'ancien nom temporaire `schema_railway.sql` | `db/schema.sql` + docs | ✔ | 🔴 | ☐ |
| Z6 | Fusionner les `CARTOGRAPHY_360` en une seule canonique datée | `docs/CARTOGRAPHY_360.md` ; `docs/chantier/CARTOGRAPHY_360.md` devient redirection | ✔ | 🟢 | ☑ |
| Z7 | Supprimer/quarantaine du dead code non monté à endpoints dupliqués | `routes/client-account.js` | ✔ | 🟡 | ☑ |
| Z8 | Supprimer dead code chargé au boot | `utils/sms.js`, `utils/parcelSync-v2.js`, `parcel-api-v2/helpers.syncParcelToOrders` | ✔ | 🟢 | ☑ |
| Z9 | Supprimer le mock prod + la page tombstone 410 | `b-modal-social-proof-mock.js`, `event-create.js` | ✔ | 🟡 | ☑ |

---

## 4. BLOC 1 — Sécurité

| ID | Fichier (chemin) | Axe | Défaut → Correction | Vérif | Prio | Statut |
|---|---|---|---|---|---|---|
| S1 | `middleware/auth-guest.js` | SÉC | CAS 1 ne vérifie pas `revoked_tokens` → ajouter le check (pattern `auth.js`) | ✔ | 🔴 | ☐ |
| S2 | `middleware/require-verified-identity.js` | SÉC | idem `revoked_tokens` absent → ajouter le check | ✔ | 🔴 | ☐ |
| S3 | `routes/client-auth.js` | SÉC | magic-link JWT sans `jti` + `jwt.verify` inline → `jti` + `authenticate` | | 🔴 | ☐ |
| S4 | `routes/client-tracking.js` | SÉC | lit cookie mort `kmrc_client` (→401) + `jwt.verify` inline → `kmrc_jwt` + `authenticate` | | 🔴 | ☐ |
| S5 | `routes/notification-api.js` | SÉC | GET sans auth expose téléphones → `authenticate` + `requireRole` | | 🔴 | ☐ |
| S6 | `routes/transit-dashboard.js` | SÉC | GET sans auth expose colis → `authenticate` + `requireAdmin` | | 🔴 | ☐ |
| S7 | `routes/pricing.js`, `routes/payments.js` | SÉC | `/rates` sans auth → `authenticate` | | 🟡 | ☐ |
| S8 | `routes/invoices.js` | SÉC | IDOR `GET /:orderId` → check propriétaire | | 🔴 | ☐ |
| S9 | `public/boutique/js/komerce-api.js` | SÉC | `komerce_api_url` localStorage non validé → whitelist origin | | 🔴 | ☐ |
| S10 | `b-checkout.js` + `b-checkout-render.js` | SÉC | XSS relais `r.name`/`r.address` → `sanitize()` (2 fichiers) | | 🔴 | ☐ |
| S11 | `public/boutique/js/b-checkout.js` | SÉC | `console.debug(identity)` nom+tel en prod → supprimer | | 🔴 | ☐ |
| S12 | `public/boutique/js/b-cart-pill.js` | SÉC | `product.name` innerHTML popover → `sanitize()` | | 🟡 | ☐ |
| S13 | `public/boutique/js/b-tracking.js` | SÉC | `o.reference`/`o.id`/`user.name` non échappés → `sanitize()` | | 🟡 | ☐ |
| S14 | `b-bus.js` + `b-store.js` | SÉC | `window._kbus`/`_kstate` exposés prod → guard env | | 🟢 | ☐ |
| S15 | `public/js/auth-guard.js` | SÉC | surveille mauvaise clé + supprime token fantôme → bonne clé/`/api/auth/me`, retirer suppression | | 🔴 | ☐ |
| S16 | `public/dashboards/admin/js/app.js` | SÉC | pas d'auth-guard au boot → check `/api/auth/me` + redirect | | 🔴 | ☐ |
| S17 | `routes/tracking.js` | SÉC | rate-limit pickup en mémoire (perdu au redeploy) → table DB | | 🔴 | ☐ |
| S18 | `utils/email.js` | SÉC | sender `fatehsamyr@gmail.com` en dur → `process.env.BREVO_SENDER_EMAIL` | | 🟡 | ☐ |
| S19 | `routes/admin-customs-categories.js`, `routes/admin-risk-provisions.js` | SÉC | `authenticate` seul → ajouter `requireRole` | | 🟡 | ☐ |

---

## 5. BLOC 2 — Control Tower vivant *(chemins re-audités → `public/dashboards/admin/`)*

| ID | Fichier | Défaut → Correction | Vérif | Prio | Statut |
|---|---|---|---|---|---|
| CT1 | `public/dashboards/admin/js/views/ControlTowerView.js` | vérifier le rôle admin via l'état auth canonique du dashboard moderne | ✔ | 🔴 | ☐ |
| CT2 | `public/dashboards/admin/js/app.js` / store auth associé | aliasing/fallback rôles à garder cohérent avec `user_role` DB | ✔ | 🔴 | ☑ |
| CT3 | API utilisée par `ControlTowerView.js` | vérifier payload relais scan : `event_type`, pas `{step}` | ✔ | 🟢 | ☐ |
| CT4 | vues dashboard modernes | ne pas avaler les erreurs ; afficher un feedback exploitable | ✔ | 🟡 | ☐ |

---

## 6. BLOC 3 — Métier & parcours

| ID | Fichier | Axe | Défaut → Correction | Prio | Statut |
|---|---|---|---|---|---|
| M1 | `routes/pickup-secret.js` | TEC | `cached.code` (ReferenceError, 500) → `revealRow.code` | 🔴 | ☐ |
| M2 | `routes/order-api-v2.js` | MÉT | confirm-cash bypasse cycle → `confirmPaymentCycle()` | 🔴 | ☐ |
| M3 | `utils/refunds.js` | TEC | `createStoreCredit()` (D5 throw) crash cash_relais → `wallet-service` | 🔴 | ☐ |
| M4 | `routes/cash.js` | SÉC | `/collect/:orderId` sans check cross-relais → répliquer pattern `payments.js` | 🔴 | ☐ |
| M5 | `routes/transit-dashboard.js` | MÉT | `POST /:ref/transit` bypass `parcelSync` → router via scan-engine | 🟡 | ☐ |
| M6 | `routes/shared-cart.js` | MÉT | admin expire impossible sur `fully_funded` → ajouter au `WHERE IN` | 🟡 | ☐ |
| M7 | `b-tracking.js` | SÉM | `TRACK_STEPS` divergent → aligner sur enum (`pending/preparation/available/collected`) | 🟡 | ☐ |
| M8 | `b-catalog.js` + `b-modal-core.js` | SÉM | `promo_pct≥100` → `Infinity KMF` → garde de division | 🟡 | ☐ |
| M9 | `b-modal-core.js` | SÉC | fetch variantes sans `credentials:'include'` → ajouter | 🟡 | ☐ |
| M10 | `b-checkout.js` | TEC | `_loadRelaisSection` sans AbortController → annuler requête précédente | 🟡 | ☐ |
| M11 | `b-checkout.js` | SÉM | bouton « Confirmer » ignore wallet → afficher net | 🟢 | ☐ |

---

## 7. BLOC 4 — Hygiène & dette

| ID | Fichier | Défaut → Correction | Prio | Statut |
|---|---|---|---|---|
| H1 | `routes/hub-dashboard.js`, `routes/shares.js`, `services/collective-stock-reservation-service.js`, `routes/economic-engine.js` | DDL/seed au chargement → migrations dédiées | 🟡 | ☐ |
| H2 | `routes/signals.js`, `utils/store-credits.js` | `log` non importé (ReferenceError) → importer logger | 🟡 | ☐ |
| H3 | `middleware/error-handler.js` | fallback log récursif (stack overflow) + `req.id`→`req.requestId` | 🟡 | ☐ |
| H4 | `middleware/rate-limit.js` | `adminLimiter` skippe GET sans plafond → plafond souple | 🟢 | ☐ |
| H5 | `routes/products.js` | `GET /` sans plafond serveur → `Math.min(limit, MAX)` | 🟢 | ☐ |
| H6 | `scripts/migrate.js` | n'appelle pas `run-migrations.js` → corriger ou supprimer | 🟡 | ☐ |

---

## 8. BLOC 5 — Décision structurante *(humaine — bloque CT2 et 5 routes backend)*

| ID | Sujet | Options | Statut |
|---|---|---|---|
| D1 | Rôles `founder` / `super_admin` (absents de l'enum `user_role`) | **A)** `ALTER TYPE user_role ADD VALUE` + `requireRole(['admin','founder'])` partout. **B)** purge : ne garder que `admin`. | **Décision prise : B — purge.** |

Conséquence : CT2 + routes backend concernées doivent converger vers `admin` uniquement.

---

## 9. Journal des corrections

| Date | IDs | Résumé | Patch / Commit | Notes |
|---|---|---|---|---|
| 2026-05-31 | D1 | Décision **B (purge)** retenue + appliquée : `founder`/`super_admin` retirés de 7 routes backend | `D1_purge_founder.patch` | — |
| 2026-05-31 | CT2 | `ct-platform.js` aliasing `agent_relais`/`agent_hub`, fallback `none`, logout `null` ; 0 résidu, `node --check` OK | `D1_purge_founder.patch` | — |
| 2026-05-31 | Z1-Z3,Z7,Z9 | Suppressions zombies (37 fichiers : `dashboard.js`, `auth-middleware.js`, `client-account.js`, `ct-*`×30, mock, `event-create.js`) — 0 référence active, intégrité ✓ | `git rm` | — |
| 2026-05-31 | Z8 | `sms.js` + `parcelSync-v2.js` supprimés ; `syncParcelToOrders` retiré de `helpers.js` (0 appelant) ; commentaire `parcels.js` nettoyé ; `node --check` OK | `bloc0_edits.patch` + `git rm` | — |
| 2026-06-01 | Z4,Z6 | Source CT clarifiée : owner = `public/dashboards/admin/`, vue principale `ControlTowerView.js`. `docs/chantier/CARTOGRAPHY_360.md` transformé en redirection vers `docs/CARTOGRAPHY_360.md`. | PR docs | Z5 reste ouvert tant que `db/schema.sql` n'est pas un vrai dump prod. |
| 2026-06-01 | Z5 | Ancien nom temporaire `schema_railway.sql` retiré des sources de vérité actives. `db/schema.sql` réservé comme cible canonique. | PR docs | Ne pas marquer done avant remplacement par un vrai `pg_dump --schema-only`. |

---

## 10. Critères de sortie globaux

1. `npm test` ou équivalent smoke passe.
2. Le dépôt ne référence que des fichiers présents comme sources de vérité actives.
3. Les chemins CT documentés pointent vers `public/dashboards/admin/`.
4. `docs/CARTOGRAPHY_360.md` est la cartographie canonique ; le doublon chantier n'est plus édité.
5. `db/schema.sql` contient le vrai schéma prod avant fermeture Z5.
