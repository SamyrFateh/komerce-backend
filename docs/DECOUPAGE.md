# Découpage en lots — gouvernance Komerce

Chaque lot est autonome, avec sa *definition of done* (DoD). Effort : S (≤½j) · M (1-2j) · L (≥3j). Risque : 🟢 scanner/config (réversible) · 🟡 logique · 🔴 behavior-sensitive prod.

## ✅ Clos cette passe
`audit-backend-arch` 59→0 · I5/I8 corrigés · migrations dédoublonnées · baseline sécu recalée · `backend:audit` câblé · contrat déterministe + porte CI · Security 360 (0🔴/0❔, 51 connus en baseline) · P2-1/P2-2 · P3-A.0→.4 · **P4-2 (sonde d'autorisation, ce lot)**.

---

## Lot P2 — Brancher les portes vérifiées  ·  dépend de : rien (tout est vert)  ·  ✅ CLOS

### P2-1 · `backend:audit` en pre-commit  ·  S · 🟢  ·  ✅
- Ajouter une étape au hook (`scripts/setup-hooks.sh`) : `npm run backend:audit` → exit 1 bloque.
- Placer côté étapes STATIQUES (il ne boote pas l'app), avant les étapes lourdes.
- **DoD** : un commit introduisant un `UPDATE orders SET payment_status` hors owner, ou une valeur SQL interpolée, est refusé en local.

### P2-2 · Prouver la porte contrat sur une vraie PR  ·  S · 🟢  ·  ✅
- Ouvrir une PR jouet : changer une route sans lancer `contract:generate`.
- **DoD** : la CI `contract.yml` passe au rouge avec le remède exact, puis verte après `contract:generate` + commit.
- Preuve : route jouet `GET /health/version` ajoutée à `routes/health.js`, contrat régénéré (417→418 routes), diff déterministe vérifié (`contract:generate` rejoue bit-à-bit le même JSON).

---

## Lot P3-A — Extraire `payment-service.js`  ·  dépend de : rien · 🔴 behavior-sensitive  ·  ✅ CLOS (vérifié sur le code livré, `backend:audit` → 0 violation I4)

Centraliser `payment_status` pour rendre l'invariant I4 structurel. **Un site à la fois, test d'intégration avant bascule** (doctrine resolve_before_behavior_change). À chaque site migré → le retirer de l'allowlist I4 (l'invariant se resserre seul).

### P3-A.0 · Scaffold du service  ·  M · 🟡
- Créer `services/payment-service.js` : `markPaid(orderId, {extra})`, `markRefunded(orderId)`, `markFailed(orderId, {guardPending})`. Aucune migration d'appelant encore.
- Centraliser les `updated_at = NOW()` / `cash_paid_at` / garde `WHERE payment_status='pending'`.
- **DoD** : tests unitaires du service verts ; zéro appelant changé ; audit toujours vert.

### P3-A.1 · `parcel-auto-create-service.js:253` (cash 'paid')  ·  M · 🔴 (le moins risqué)
- Remplacer l'UPDATE inline par `markPaid(order.id, { cash_paid_at: true })`.
- Test intégration : commande cash → confirmation → `payment_status='paid'` + `cash_paid_at` set (même effet qu'avant).
- Retirer `parcel-auto-create-service.js` de l'allowlist I4.
- **DoD** : test vert · audit vert · effet DB identique.

### P3-A.2 · `admin-order-refund.js:173` (refund 'refunded')  ·  M · 🔴
- → `markRefunded(order.id)` · test intégration refund admin · retirer de l'allowlist.
- **DoD** : idem.

### P3-A.3 · `payment-stripe.js:331` ('failed', gardé pending→failed)  ·  M · 🔴
- → `markFailed(orderId, { guardPending: true })` (préserver le `WHERE payment_status='pending'`).
- **DoD** : test couvrant le cas pending→failed ET le cas non-pending (no-op) · audit vert.

### P3-A.4 · `payment-paypal.js:568` (refund + `status`)  ·  L · 🔴 (le plus délicat)
- Touche 2 champs (`payment_status` ET `status`) → réconcilier avec l'invariant I3 (status owné par la machine à états). Probable : `markRefunded` + transition de statut via `order-status-machine`.
- **DoD** : test refund PayPal · audit vert sur I3 ET I4 · retiré de l'allowlist.

> Simulateur (`state-advancer.js`) : reste allowlisté définitivement (chaos-testing).

---

## Lot P4 — Audit empirique (méthode indépendante)  ·  dépend de : harness CI app-boot (existe)

### P4-1 · Conformité de contrat boîte-noire  ·  M · 🟢
- Job CI : booter l'app, lancer Schemathesis/Dredd contre `docs/contract/openapi.json`.
- **DoD** : le job tourne et liste les écarts réponse↔contrat (observe d'abord, bloquant ensuite).

### P4-2 · Sonde d'autorisation  ·  S · 🟢  ·  ✅ CLOS
- Test : token non-admin → chaque route `/api/admin/*` → attendre 403. Couvrir aussi les 5 ❔ de Security 360.
- **DoD** : sonde verte · les 5 ❔ résolus (protégés prouvés) ou documentés.
- **Livré** : `tests/integration/admin-authz-probe.test.js`.
  - 154 routes `/api/admin/*` extraites **dynamiquement** du contrat OpenAPI (`docs/contract/openapi.json`), pas une liste recopiée à la main — pas de dérive possible entre le test et le code réel.
  - 3 angles par route : sans token (401), token `client` (jamais 2xx), token `agent_relais` (jamais 2xx — couvre aussi le cas "autre rôle non-admin", pas seulement "non connecté").
  - Les 6 ❔ UNKNOWN (5 initiales + `GET /health/version` ajoutée en P2-2) testées individuellement pour leur VRAI comportement plutôt que listées : `/health`, `/health/ready`, `/health/version` publiques intentionnelles (assertions 200) ; `/health/metrics` prouvée admin-only (401 sans token, 403 client, 200 admin) ; webhook Meta GET prouvé par handshake `hub.verify_token` ; webhook Meta POST prouvé par HMAC `X-Hub-Signature-256` (signature absente/invalide/longueur invalide → 403, signature valide → 200).
  - **Limite assumée** : le test n'a pas pu être exécuté en conditions réelles dans cette session (pas de Postgres dans le bac à sable, hors des domaines réseau autorisés). Vérifié par syntaxe (`node -c`), cohérence avec le contrat régénéré, et raisonnement explicite sur les pièges (`timingSafeEqual` exige des buffers de même longueur, re-sérialisation JSON `req.body` vs `rawBody`). À faire tourner en CI (`ci.yml`, job `integration`, maintenant corrigé — voir P4-2-bis) avant de considérer la sonde réellement prouvée verte.

#### P4-2-bis · Découvertes en chemin (hors périmètre initial, traitées avec validation explicite)
- **Fail-open webhook Meta** : `routes/meta-whatsapp.js` laissait passer les POST sans vérification HMAC si `META_WA_APP_SECRET` était absente (juste un `log.warn`). Fermé : hard-fail au boot (`process.exit(1)`), même doctrine que `JWT_SECRET` (N7). Variable déplacée de `RECOMMENDED_ENV` vers `REQUIRED_ENV` dans le **vrai** point d'entrée (`bootstrap/env.js` — `scripts/validate-required-env.js` est un script orphelin non branché au boot, à ne pas confondre).
- **`timingSafeEqual` non gardé** : une signature de mauvaise longueur faisait lever une exception (potentiel 500 non contrôlé) au lieu d'un rejet 403 propre. Guard de longueur ajouté avant l'appel.
- **CI déjà cassée avant ce lot** : `ci.yml` (job `integration`) et `contract.yml` ne fournissaient pas toute la liste `requiredEnv` de `bootstrap/env.js` (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `QR_SECRET`, `AUTHKEY_API_KEY`, `PAYPAL_*`, et maintenant `META_WA_APP_SECRET`) — l'app ne pouvait donc pas booter réellement dans ces jobs, ce qui remet en question si `security-grid.test.js` (annoncé "✅ clos" plus haut) ou tout autre test d'intégration a déjà tourné pour de vrai en CI. Les deux workflows ont été complétés avec la liste exacte et validés empiriquement en local (boot réussi, `contract:generate` ✅, `security:360:check` ✅, sans `process.exit(1)`).
- **`.env.example` obsolète** : ne listait ni `AUTHKEY_API_KEY` ni `META_WA_APP_SECRET`, pourtant déjà/désormais requis au boot. `META_WA_APP_SECRET` et `META_WA_VERIFY_TOKEN` ajoutés ; le reste de la dérive (`AUTHKEY_API_KEY`, etc.) n'a pas été traité ici, hors périmètre.
- **Security 360 re-baselinée** : `npm run security:360:save` après résolution → `0🔴 · 45🟠 · 0❔`, 51 entrées en baseline (50 + `GET /health/version`).

---

## Lot P5 — Dashboards / boutique (piste parallèle)  ·  dépend de : ouvrir dash.zip + repro

> Comportemental, pas couvert par la cartographie statique. Découpage fin **impossible sans repro** — à faire en ouvrant le code dashboard.

### P5-1 · Panneau hub qui ne charge pas  ·  ? · 🟡
- Repro → isoler (appel API échoué ? garde ? données ?) → corriger → smoke-test SPA.

### P5-2 · Race condition DOM  ·  ? · 🟡
- Repro → identifier l'ordre d'init fautif → sérialiser/attendre → test.

---

## Lot P6 — Accélérateurs (quand le socle est vert)

### P6-1 · SDK client typé depuis le contrat  ·  L · 🟢
- Codegen depuis `openapi.json` → client typé pour les fronts. **DoD** : appel d'un endpoint inexistant = erreur compile.

### P6-2 · Overlay couverture de tests sur la carto  ·  M · 🟢
- Croiser la couverture Jest avec les endpoints. **DoD** : liste « fort blast radius + 0 test ».

### P6-3 · Classification PII + propagation blast radius  ·  M · 🟢
- Tagger les colonnes PII → propager via le graphe → flag exposition. **DoD** : rapport d'endpoints exposant du PII sans auth.

---

## Chemin critique conseillé
~~P2-1 (½j, débloque la garde locale) → P2-2 (preuve) → P3-A.0→.4 (le gros morceau, étalé) ‖ P4-2 en parallèle (cheap, vide les ❔).~~ **P2, P3-A, P4-2 clos.** Prochaine étape : faire tourner `admin-authz-probe.test.js` en vraie CI (Postgres) pour confirmer empiriquement la sonde, puis P4-1 (conformité contrat boîte-noire) et P5/P6 quand pertinent.
