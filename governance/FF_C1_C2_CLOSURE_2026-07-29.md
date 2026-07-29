# Clôture FF-C1 / FF-C2 — 2026-07-29

## Verdict exécuté

- **FF-C1 : PASS** — 0 paire inter-feature non déclarée.
- **FF-C2 : PASS** — 0 inversion support → métier hors composition root ou exception nominative.
- Dépendances runtime déclarées : 104 paires, portées par 326 imports.
- Câblage reconnu par composition root : 8 paires, portées par 17 imports.

## Décisions structurelles

1. `notifications → decision-signals` n'a pas été sanctionnée : Notifications émet un fait neutre, traduit en signal dans `bootstrap/feature-wiring.js`.
2. `infrastructure → business-rules` n'a pas été sanctionnée : le fallback de taux est injecté par le même composition root.
3. Toutes les autres paires runtime observées sont déclarées une fois dans `contract.consumes`, avec leurs preuves de fichiers.
4. FF-C1 et FF-C2 sont des invariants **DUR** : aucune baseline ne peut les rendre acceptables.

## Fichiers concernés

- `bootstrap/feature-wiring.js`
- `capabilities/decision-signals.capability.js`
- `features/business-rules.feature.js`
- `features/catalog.feature.js`
- `features/economic-engine.feature.js`
- `features/infrastructure.feature.js`
- `features/logistics.feature.js`
- `features/loyalty.feature.js`
- `features/notifications.feature.js`
- `features/orders.feature.js`
- `features/payments.feature.js`
- `features/platform-ops.feature.js`
- `features/shared-cart.feature.js`
- `features/wallet.feature.js`
- `governance/composition-root-files.json`
- `server.js`
- `services/notifications/internals.js`
- `tests/governance/feature-first/lib/checks.js`
- `utils/rates.js`
