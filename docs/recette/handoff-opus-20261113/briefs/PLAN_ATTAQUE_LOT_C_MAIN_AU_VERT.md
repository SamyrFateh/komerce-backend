# Plan d'attaque — Lot C « Remettre `main` au vert » (revue 2026-11-10, `main` @ d6ba5d7)

> Exécutant : Sonnet. Règles : `AGENTS.md` §3 (gates), §9 (divergence : corriger dans la PR, jamais en silence). Merge autonome CI verte.
> Les migrations exigent l'historique complet : `git fetch --unshallow origin` si un diff en touche.

## C1 — Schema drift (`map:check` étape 7, `node scripts/arch-schema-drift-check.js`)
- **Constat** : 24 tables live non documentées (cliquet 0) + 3 « fictions » de header :
  `central authority grant tables`, `local_stock_allocations (via capacités canoniques)`, `market_delegation_audit (via delegation.audit)`.
- **Correctif** : documenter les 24 tables dans `SCHEMA.md` (owner feature + rôle, sans inventer : partir de la migration qui les crée), puis `npm run arch:reconcile -- --write`. Pour les 3 fictions : corriger le `@db-*` du header vers le vrai nom de table ; si la table n'existe pas en live, c'est une divergence §9 → la signaler dans la PR.
- Vérif : `npm run arch:gate` vert.

## C2 — Artefacts périmés
- `npm run feature:360:refresh-global` → `docs/FEATURE_360.{json,md}` ; régénérer aussi `docs/BUSINESS_FEATURE_GRAPH.{json,md}` (redevenus sales au simple run des gates).
- `boutique:360:check` : nouveau consommateur non déclaré `modal:closed` (`js/discovery-rail.js:408`, `js/group/group-side-cart.js:942`, `js/b-modal-discovery-detail.js:389`). Vérifier qu'ils sont légitimes → `npm run boutique:360:save` ; sinon corriger.
- **Cause racine** : identifier pourquoi ces artefacts dérivent sur `main` sans bloquer (gate absent du preflight ou exemption) et le corriger, sinon le lot sera à refaire.

## C3 — Gates morts ou non appliqués
- `check:boutique` (`scripts/check-boutique.mjs`) cherche 6 CSS qui n'existent plus (`boutique.css`, `boutique-base.css`, `boutique-modal.css`, `boutique-cart-checkout.css`, `boutique-interactions.css`, `boutique-mobile.css`). Le réaligner sur l'architecture CSS actuelle (`docs/BOUTIQUE_COMPONENT_OWNERSHIP.md`) ou le supprimer avec son script npm ; ne pas le laisser rouge et hors CI.
- `testkit:headers --strict` : 178 tests sans `@test-kind`, 2 `@test-requires remote-webapp` inconnus. Ajouter les headers (classification mécanique selon le dossier : `tests/unit` → unit, `tests/e2e`/`*.spec.js` → e2e, etc.), déclarer `remote-webapp` si légitime, puis brancher le gate dans `scripts/pr-preflight.js` et la CI (respecter le test de parité preflight/CI).

## C4 — Headers de code manquants (petit)
- 14 services, 1 middleware, 1 feature, 29 fichiers dashboards sans header. Liste :
  ```bash
  grep -rL "@inputs\|@feature\|@module" services middleware features --include=*.js
  ```
  Ajouter les headers au format canonique ; ne rien changer d'autre.

## Hors lot (dette notée, ne pas traiter ici)
WRITER-NOT-OWNER (6 tables) et mutations de colis hors service canonique (LS-04 ×9, LS-05 ×3) : chantier d'architecture à cadrer séparément.

## Définition de fini
`npm run map:check`, `feature:360:check`, `boutique:360:check`, `testkit:headers` verts sur `main` ; plus aucun gate rouge hors CI ; cause racine de la dérive des artefacts corrigée.
