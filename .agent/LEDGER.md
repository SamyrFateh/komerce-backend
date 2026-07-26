# LEDGER — Komerce gouvernance

## Bloc A — Stabilisation produit

[DONE]      P0-A câbler les 5 mesures du harnais dans la suite (session précédente)
[DONE]      P0-C capture-hero-flash.js — instrument seul, ?trace=hero, coût nul sans drapeau
            preuve: .agent/evidence/P0-C/
[ESCALATED] P0-B couverture SKU — Classe C (choix contrat API), outil vérifié (13 tests verts,
            DB mockée), mesure réelle bloquée (pas d'accès DB prod depuis ce sandbox)
            → ARBITRAGES.md #P0-B
[BLOCKED]   P0-D (3 scripts inline restants index.html) — Classe C, NE PAS externaliser :
            2 protégés par location.reload() mort (externaliser rouvre le chemin),
            1 (mesure hero mobile) = perte réelle à restaurer. Aucune action tant que non tranché.
            → ARBITRAGES.md #P0-D
[DONE]      P0-E sticky hero modale + suggestions (session courante)
            — index.html : suggestions/enriched-content rapatriés dans .k-modal-product-zone
            — modal-shell.css : grid-template-rows 1fr auto → 1fr auto auto, grid-row 1/-1
            — 13 cas verts dans harnais/geometry/audit-sticky-reference.js
            — plafond contrat (20 axes × 100 valeurs) : ✅ épinglé partout

## Bloc B — Gouvernance exécutable

[DONE]      P1 invariant #1 auth-identity (mutating-routes-guarded)
            preuve: tests/invariants/auth-identity.mutating-routes-guarded.test.js
            R2: guard PUT /me retiré → test échoue (bonne raison) → restauré → vert
            angle mort corrigé: PUBLIC (gen-security-360) rejeté — regex insensible méthode

[DONE]      P1 invariants #2–#5 — session 2026-07-26
            preuve: .agent/evidence/P1/invariants-2-5.txt
            #2 payments — idempotence webhook Stripe/PayPal
                tests/invariants/payments.webhook-idempotency.test.js — 4 tests verts
            #3 payments — pas de double confirmation
                tests/invariants/payments.no-double-confirm.test.js — 2 tests verts
            #4 wallet — application une seule fois par événement source
                tests/invariants/wallet.single-application-per-event.test.js — 3 tests verts
            #5 orders — remboursement au payeur, jamais au destinataire
                tests/invariants/orders.refund-to-payer.test.js — 4 tests verts
            R2: 4 violations injectées → 2 fails détectés, restauration confirmée verte
            Manifestes mis à jour (forme {statement, test}) : payments, wallet, orders

[DONE]      feature-schema-check.js — schéma invariants étendu à {statement, test}
[DONE]      auth-identity.feature.js — invariant #1 basculé en forme {statement, test}

[WIP]       P1 — feature-invariant-check.js (gate vérifiant que les tests référencés existent
            et passent) — non créé, identifié dans la roadmap
[WIP]       P2 — tests de détection par gate — non commencé
