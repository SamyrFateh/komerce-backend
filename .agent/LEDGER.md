# LEDGER — Komerce gouvernance
Mis à jour : 2026-07-26

## Bloc A — Stabilisation produit

[DONE] P0-A #1 hero sticky modale   — modal-geometry.spec.js (session précédente)
[DONE] P0-A #2 grille vide recherche — E20c-bis ajouté à search.spec.js (session courante)
                                        (E20c existant : ouvre modale ; E20c-bis : grille ≥1 carte après fermeture)
[DONE] P0-A #3 plafond hero repli   — hero-geometry.spec.js (session précédente)
[DONE] P0-A #4 bouton retour-haut   — modal-backtop-zindex.spec.js (session précédente)
[DONE] P0-A #5 gates aveugles       — csp-fronts.spec.js (session précédente)

[DONE] P0-C capture-hero-flash.js   — instrument ?trace=hero, câblé index.html (session précédente)

[DONE] P0-D /hub/ /relais/ /login.html   — 0 script inline chacun (session précédente)
[DONE] P0-D check-inline-scripts étendu  — scanne public/ entier (session précédente)
[ESCALATED] P0-D 3 scripts index.html    — Classe C, décision en attente :
              script 1&2 : location.reload() mort = actuellement protecteur
              script 3 : mesure hero mobile = perte réelle à restaurer
              → ARBITRAGES.md #P0-D

[DONE] P0-E sticky hero + suggestions  — suggestions dans .k-modal-product-zone
                                          modal-shell.css : 1fr auto auto + grid-row 1/-1
                                          13 cas verts jusqu'au plafond contrat (session courante)

[MEASURED]  P0-B couverture SKU        — Classe C (décision migration en attente)
              Décision actée : DECISION_MODELE_STOCK_SKU.md (Option A, 2026-07-12)
              Mesure prod (2026-07-26) :
                total_active_products : 591
                already_sku           : 1  (0,2 %)
                ready_not_switched    : 0
                not_ready             : 590
                fallback_removable    : false
              État : entre Lot 0 (schéma) et Lot 1 (préparation SKU admin)
              Prochaines étapes (Classe C — décision métier) :
                1. node scripts/check-sku-coverage.js --backfill  (dry-run : produits sans variantes migrables)
                2. Interface admin : déclarer combinaisons + stock réel pour produits avec variantes
                3. node scripts/check-sku-coverage.js --backfill --apply --switch-ready  (quand prêt)

## Bloc B — Gouvernance exécutable

[DONE] P1 invariant #1 auth-identity — tests/invariants/auth-identity.mutating-routes-guarded.test.js
                                         R2 prouvé (session précédente)
[DONE] P1 invariant #2 payments webhook-idempotency — tests/invariants/payments.webhook-idempotency.test.js
[DONE] P1 invariant #3 payments no-double-confirm   — tests/invariants/payments.no-double-confirm.test.js
[DONE] P1 invariant #4 wallet single-application    — tests/invariants/wallet.single-application-per-event.test.js
[DONE] P1 invariant #5 orders refund-to-payer       — tests/invariants/orders.refund-to-payer.test.js
       R2 prouvé (session courante) — preuve : .agent/evidence/P1/invariants-2-5.txt
       invariantsExecutables = 5/79 ≥ 5 ✅ critère P1 atteint

[DONE] feature-schema-check.js — schéma {statement, test} (session précédente)
[DONE] manifestes mis à jour   — auth-identity, payments, wallet, orders (sessions précédente + courante)

[DONE] P1 feature-invariant-check.js — scripts/feature-invariant-check.js
              branché dans map-check.js (Gate 2b) et package.json
              R2 prouvé : fichier manquant → exit 1 + FICHIER INTROUVABLE
                          test échoue    → exit 1 + TEST ÉCHOUE
              4/5 verts en sandbox (auth-identity nécessite JWT_SECRET du .env)
              5/5 verts attendus en prod avec .env complet
[WIP]  P2 tests de détection par gate — non commencé
